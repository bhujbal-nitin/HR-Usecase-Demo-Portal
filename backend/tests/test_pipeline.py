"""End-to-end pipeline behaviour with fake external systems."""

from dataclasses import dataclass, field

import pytest

from app.container import build_container
from app.core.exceptions import ConflictError, IntegrationError
from app.integrations.automationedge import WorkflowResult
from app.integrations.orangehrm import ProfileResult
from app.integrations.servicenow import CatalogRequest, Incident
from app.schemas.employee import CandidateCreate, Office365Info, OrangeHrmInfo, StepStatus
from app.services.pipeline.context import PORTAL_SOURCE, SERVICENOW_SOURCE
from tests.conftest import PDF, PNG_DATA_URL, wait_for


def _workflow(name: str, status: str = "Complete", request_id: int = 100) -> WorkflowResult:
    return WorkflowResult(name, request_id, status, "agent-1", "done", f"https://t4/#/workflowinstances/{request_id}")


@dataclass
class FakeServiceNow:
    approved: list[str] = field(default_factory=list)
    attachments: list[str] = field(default_factory=list)
    incident_descriptions: list[str] = field(default_factory=list)
    remote_approval: str = "requested"

    def is_configured(self):
        return True

    created: list = field(default_factory=list)

    def create_onboarding_request(self, emp, attachments):
        self.created.append(emp.id)
        return CatalogRequest("REQ0010001", "RITM0010001", "req-sys", "ritm-sys", "http://sn/req", "http://sn/ritm",
                              [a.filename for a in attachments], ["approval task: denied"])

    def approve_request(self, sys_id):
        self.approved.append(sys_id)

    def reject_request(self, sys_id, name):
        self.approved.append(f"rejected:{sys_id}")

    def attach_file(self, table, sys_id, attachment):
        self.attachments.append(f"{table}:{attachment.filename}")

    def create_hardware_incident(self, emp, description, emp_number):
        self.incident_descriptions.append(description)
        return Incident("INC0012345", "inc-sys", "http://sn/inc")

    def get_request_approval(self, sys_id):
        return self.remote_approval, "REQ0010001"


class FakeAutomationEdge:
    def __init__(self, fail: set[str] | None = None):
        self.fail = fail or set()
        self.calls: list[str] = []

    def _run(self, key: str, name: str, request_id: int) -> WorkflowResult:
        self.calls.append(key)
        return _workflow(name, "Failed" if key in self.fail else "Complete", request_id)

    def get_emp_details(self, emp):
        return self._run("details", "HR Demo Get Employee Details", 1)

    def management_approval(self):
        return self._run("mgmt", "HR Demo Management Approval", 2)

    def create_ad_user(self, emp, email):
        return self._run("ad", "HR Demo AD user creation and Assign role", 3)

    def create_o365_user(self):
        return self._run("o365", "HR Demo O365 User Creation", 4)

    def add_emp_orangehrm(self, emp):
        return self._run("ohrm", "HR Demo Add emp OrangeHRM", 5)

    def create_laptop_request(self, emp):
        return self._run("laptop", "HR Demo Create Laptop Request", 6)


class FakeOffice365:
    def create_user(self, emp):
        return Office365Info(user_id="u-1", user_principal_name="aarav.sharma@corp.example", display_name=emp.full_name,
                             initial_password="Temp#Pass123")


class FakeOrangeHrm:
    def __init__(self):
        self.work_email = None
        self.document_names: list[str] = []

    def create_employee_profile(self, emp, work_email, documents):
        self.work_email = work_email
        self.document_names = [name for name, _, _ in documents]
        return ProfileResult(OrangeHrmInfo(emp_number=17, employee_id="123456", work_email=work_email,
                                           profile_url="http://ohrm/17", attached_documents=self.document_names))


@pytest.fixture
def wired(settings):
    container = build_container(settings)
    container.task_queue.start()
    gw = container.onboarding._gw  # noqa: SLF001 - test wiring
    gw.servicenow, gw.automationedge = FakeServiceNow(), FakeAutomationEdge()
    gw.office365, gw.orangehrm = FakeOffice365(), FakeOrangeHrm()
    yield container
    container.task_queue.stop()


def _submit(container, candidate_form, *, wait_sync=True):
    fields = {k: v for k, v in candidate_form.items() if k != "signature"}
    files = {key: (f"{key}.pdf", PDF) for key in ("idDoc", "panDoc", "uanDoc", "salaryDoc")}
    employee = container.onboarding.submit(CandidateCreate.model_validate(fields), files, PNG_DATA_URL)
    if wait_sync:
        wait_for(lambda: container.repository.require(employee.id).intake_status.value != "running")
    return container.repository.require(employee.id)


def _finished(container, employee_id):
    return wait_for(lambda: (e := container.repository.require(employee_id)).status.value == "Approved" and e)


def test_submit_syncs_servicenow_and_candidate_workflow(wired, candidate_form):
    employee = _submit(wired, candidate_form)
    assert employee.service_now.req_number == "REQ0010001"
    assert employee.service_now.approval_status == "Pending Approval"
    assert sorted(employee.service_now.attached_documents) == ["idDoc.pdf", "panDoc.pdf", "salaryDoc.pdf", "uanDoc.pdf"]
    assert employee.service_now.sync_error == "approval task: denied"  # warnings are surfaced, not swallowed
    assert employee.workflow_runs[0].workflow_name == "HR Demo Get Employee Details"


def test_full_approval_pipeline_succeeds(wired, candidate_form):
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    done = _finished(wired, employee.id)

    gw = wired.onboarding._gw  # noqa: SLF001
    assert [s.status for s in done.pipeline] == [StepStatus.SUCCESS] * 6, [s.message for s in done.pipeline]
    assert done.provisioning_status.value == "completed"
    assert done.approval_source == PORTAL_SOURCE
    assert gw.servicenow.approved == ["req-sys"]
    assert done.service_now.approval_status == "Approved"

    # The Microsoft 365 address produced in step 4 must be the OrangeHRM work e-mail in step 5.
    assert gw.orangehrm.work_email == "aarav.sharma@corp.example"
    assert done.office365.user_principal_name == "aarav.sharma@corp.example"
    assert "idDoc.pdf" in gw.orangehrm.document_names

    assert done.orange_hrm.emp_number == 17
    assert done.laptop.ticket_number == "INC0012345"
    assert "OrangeHRM profile: #17" in gw.servicenow.incident_descriptions[0]

    assert gw.automationedge.calls == ["details", "mgmt", "ad", "o365", "ohrm", "laptop"]

    # Each step exposes the AutomationEdge run it triggered (shown in the chat's process panel).
    ad_step = next(s for s in done.pipeline if s.key == "active_directory")
    assert ad_step.details["workflows"] == [{
        "workflowName": "HR Demo AD user creation and Assign role", "requestId": 3, "status": "Complete",
        "agent": "agent-1", "url": "https://t4/#/workflowinstances/3", "message": "done", "response": None,
    }]


def test_failed_workflow_stops_the_chain(wired, candidate_form):
    fake_ae = FakeAutomationEdge(fail={"ad"})
    wired.onboarding._gw.automationedge = fake_ae  # noqa: SLF001
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    done = wait_for(lambda: (e := wired.repository.require(employee.id)).status.value == "Provisioning Failed" and e)

    steps = {s.key: s for s in done.pipeline}
    assert steps["management_approval"].status == StepStatus.SUCCESS
    assert steps["active_directory"].status == StepStatus.FAILED
    assert "ended with status Failed" in steps["active_directory"].message
    # Nothing after the failed workflow ran, and each later step says why.
    for key in ("office365", "orangehrm", "laptop"):
        assert steps[key].status == StepStatus.SKIPPED and "Active Directory" in steps[key].message
    assert fake_ae.calls == ["details", "mgmt", "ad"]
    assert done.provisioning_status.value == "failed" and done.approved_at is None
    assert done.office365 is None and done.laptop is None


def test_exception_inside_a_step_stops_the_chain(wired, candidate_form):
    def boom(emp):
        raise IntegrationError("Microsoft 365", "tenant unreachable")

    wired.onboarding._gw.office365.create_user = boom  # noqa: SLF001
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    done = wait_for(lambda: (e := wired.repository.require(employee.id)).status.value == "Provisioning Failed" and e)

    steps = {s.key: s for s in done.pipeline}
    assert steps["office365"].status == StepStatus.FAILED and "tenant unreachable" in steps["office365"].message
    assert steps["orangehrm"].status == StepStatus.SKIPPED
    assert done.office365 is None
    assert wired.onboarding._gw.orangehrm.work_email is None  # noqa: SLF001 - never reached


def test_servicenow_poller_detects_external_approval(wired, candidate_form):
    employee = _submit(wired, candidate_form)
    gw = wired.onboarding._gw  # noqa: SLF001

    assert wired.onboarding.sync_servicenow_approvals() == []  # still "requested"

    gw.servicenow.remote_approval = "approved"
    started = wired.onboarding.sync_servicenow_approvals()
    assert [e.id for e in started] == [employee.id]

    done = _finished(wired, employee.id)
    assert done.approval_source == SERVICENOW_SOURCE
    assert gw.servicenow.approved == []  # already approved in ServiceNow: not approved a second time
    assert wired.onboarding.sync_servicenow_approvals() == []  # not picked up twice


def test_restart_closes_out_interrupted_provisioning(wired, candidate_form):
    from app.schemas.employee import EmployeeStatus, ProvisioningStatus
    from app.services.pipeline.runner import initial_pipeline

    employee = _submit(wired, candidate_form)

    def simulate_crash(e):  # status as left behind by a process that died mid-run
        e.status, e.provisioning_status, e.pipeline = EmployeeStatus.PROCESSING, ProvisioningStatus.RUNNING, initial_pipeline()
        e.pipeline[0].status = StepStatus.SUCCESS
        e.pipeline[1].status = StepStatus.RUNNING

    wired.repository.update(employee.id, simulate_crash)

    assert wired.onboarding.recover_interrupted() == 1
    recovered = wired.repository.require(employee.id)
    assert recovered.status == EmployeeStatus.FAILED
    assert recovered.provisioning_status == ProvisioningStatus.FAILED
    assert recovered.pipeline[0].status == StepStatus.SUCCESS  # finished work is preserved
    assert all(s.status == StepStatus.FAILED and "restarted" in s.message for s in recovered.pipeline[1:])
    assert wired.onboarding.recover_interrupted() == 0


def test_reject_propagates_to_servicenow(wired, candidate_form):
    employee = _submit(wired, candidate_form)
    rejected = wired.onboarding.reject(employee.id)
    assert rejected.status.value == "Rejected" and rejected.service_now.approval_status == "Rejected"
    assert wired.onboarding._gw.servicenow.approved == ["rejected:req-sys"]  # noqa: SLF001


def test_failure_in_the_last_step_does_not_undo_the_onboarding(wired, candidate_form):
    def servicenow_down(emp, description, emp_number):
        raise IntegrationError("ServiceNow", "connection closed")

    wired.onboarding._gw.servicenow.create_hardware_incident = servicenow_down  # noqa: SLF001
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    done = _finished(wired, employee.id)

    assert done.pipeline[-1].status == StepStatus.FAILED
    assert [s.status for s in done.pipeline[:-1]] == [StepStatus.SUCCESS] * 5
    assert done.provisioning_status.value == "completed_with_errors"  # everything else worked


def test_intake_waits_for_candidate_details_workflow_and_blocks_approval_on_failure(wired, candidate_form):
    wired.onboarding._gw.automationedge = FakeAutomationEdge(fail={"details"})  # noqa: SLF001
    employee = _submit(wired, candidate_form)

    assert employee.intake_status.value == "failed"
    steps = {s.key: s for s in employee.intake}
    assert steps["servicenow_request"].status == StepStatus.SUCCESS
    assert steps["candidate_details"].status == StepStatus.FAILED
    assert employee.workflow_runs[0].execution_status == "Failed"
    with pytest.raises(ConflictError, match="Retry it"):
        wired.onboarding.start_approval(employee.id)

    # Retry keeps the ServiceNow request (no duplicate) and re-runs only the failed workflow.
    sn = wired.onboarding._gw.servicenow  # noqa: SLF001
    created_before = len(sn.created)
    wired.onboarding._gw.automationedge = FakeAutomationEdge()  # noqa: SLF001
    wired.onboarding.retry_intake(employee.id)
    healed = wait_for(lambda: (e := wired.repository.require(employee.id)).intake_status.value == "completed" and e)
    assert len(sn.created) == created_before
    assert healed.intake[1].status == StepStatus.SUCCESS
    wired.onboarding.start_approval(employee.id)  # now allowed


def test_approval_is_refused_while_intake_is_running(wired, candidate_form):
    from app.schemas.employee import IntakeStatus

    employee = _submit(wired, candidate_form)
    wired.repository.update(employee.id, lambda e: setattr(e, "intake_status", IntakeStatus.RUNNING))
    with pytest.raises(ConflictError, match="still running"):
        wired.onboarding.start_approval(employee.id)


def test_rerun_resumes_from_the_failed_step_without_repeating_earlier_ones(wired, candidate_form):
    gw = wired.onboarding._gw  # noqa: SLF001
    gw.automationedge = FakeAutomationEdge(fail={"ohrm"})
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    failed = wait_for(lambda: (e := wired.repository.require(employee.id)).status.value == "Provisioning Failed" and e)
    assert {s.key: s.status for s in failed.pipeline}["orangehrm"] == StepStatus.FAILED
    assert gw.automationedge.calls == ["details", "mgmt", "ad", "o365", "ohrm"]

    gw.automationedge = FakeAutomationEdge()  # the problem is fixed; run again
    wired.onboarding.retry_provisioning(employee.id)
    done = _finished(wired, employee.id)

    assert [s.status for s in done.pipeline] == [StepStatus.SUCCESS] * 6
    assert done.provisioning_status.value == "completed"
    # Mgmt approval, AD and Microsoft 365 were NOT run again; the chain restarted at OrangeHRM.
    assert gw.automationedge.calls == ["ohrm", "laptop"]
    assert gw.servicenow.approved == ["req-sys"]  # approved once only
    assert gw.orangehrm.work_email == "aarav.sharma@corp.example"  # M365 address carried over from the first run
    assert "OrangeHRM profile: #17" in gw.servicenow.incident_descriptions[0]
    assert done.office365.user_principal_name == "aarav.sharma@corp.example"


def test_rerun_is_refused_when_nothing_failed(wired, candidate_form):
    employee = _submit(wired, candidate_form)
    with pytest.raises(ConflictError):
        wired.onboarding.retry_provisioning(employee.id)


def test_a_failed_step_can_be_skipped_and_provisioning_carries_on(wired, candidate_form):
    gw = wired.onboarding._gw  # noqa: SLF001
    gw.automationedge = FakeAutomationEdge(fail={"ohrm"})
    employee = _submit(wired, candidate_form)
    wired.onboarding.start_approval(employee.id)
    wait_for(lambda: wired.repository.require(employee.id).status.value == "Provisioning Failed")

    gw.automationedge = FakeAutomationEdge()
    wired.onboarding.skip_provisioning_step(employee.id)
    done = _finished(wired, employee.id)

    steps = {s.key: s for s in done.pipeline}
    assert steps["orangehrm"].status == StepStatus.SKIPPED and steps["orangehrm"].details["skippedByUser"] is True
    assert all(s.status == StepStatus.SUCCESS for k, s in steps.items() if k != "orangehrm")
    assert gw.automationedge.calls == ["laptop"]  # the skipped step was not run; earlier ones were not repeated
    assert done.provisioning_status.value == "completed"


def test_a_failed_intake_step_can_be_skipped(wired, candidate_form):
    wired.onboarding._gw.automationedge = FakeAutomationEdge(fail={"details"})  # noqa: SLF001
    employee = _submit(wired, candidate_form)
    wait_for(lambda: wired.repository.require(employee.id).intake_status.value == "failed")
    wired.onboarding._gw.automationedge = FakeAutomationEdge()  # noqa: SLF001
    wired.onboarding.skip_intake_step(employee.id)
    done = wait_for(lambda: (e := wired.repository.require(employee.id)).intake_status.value == "completed" and e)
    assert done.intake[-1].status == StepStatus.SKIPPED

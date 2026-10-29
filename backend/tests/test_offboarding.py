"""Offboarding: settlement rules, the API, and the chain (with the external systems replaced by fakes)."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.exceptions import IntegrationError
from app.schemas.employee import Employee, EmployeeStatus, Office365Info, OrangeHrmInfo
from app.schemas.offboarding import OffboardingStatus
from app.services.offboarding.settlement import calculate
from tests.conftest import wait_for


def test_settlement_rules():
    s = calculate(1_200_000, date(2026, 1, 1), date(2026, 1, 20), notice_period_days=30, leave_balance_days=10, basic_share=0.5)
    assert (s.monthly_gross, s.daily_rate) == (100_000, 3333)
    assert s.salary_payable == 66_667 and s.leave_encashment == 16_667  # 20 days of salary; 10 days at half the daily rate
    assert (s.notice_days_served, s.notice_shortfall_days, s.notice_recovery) == (19, 11, 36_667)
    assert s.net_payable == s.salary_payable + s.leave_encashment - s.notice_recovery


def test_no_recovery_when_notice_is_served():
    s = calculate(600_000, date(2026, 1, 1), date(2026, 3, 31), notice_period_days=30, leave_balance_days=0)
    assert s.notice_shortfall_days == 0 and s.notice_recovery == 0 and s.salary_payable == s.monthly_gross


class FakeAE:
    """Records every workflow in call order; a workflow listed in ``fail`` ends 'Failed'."""

    def __init__(self, order):
        self.order, self.fail, self.params = order, set(), {}

    def _run(self, name, **params):
        from app.integrations.automationedge import WorkflowResult

        self.order.append(name)
        self.params[name] = params
        status = "Failed" if name in self.fail else "Complete"
        return WorkflowResult(name, len(self.order), status, "agent1", "ok" if status == "Complete" else "boom", None)

    def is_configured(self):
        return True

    def get_exit_details(self):
        return self._run("exit_details")

    def exit_management_approval(self):
        return self._run("exit_approval")

    def disable_ad_user(self, first, last, receiver):
        return self._run("ad_disable", P_firstName=first, P_lastName=last, P_receiverEmailID=receiver)

    def offboard_o365_user(self):
        return self._run("o365")

    def terminate_emp_orangehrm(self):
        return self._run("orangehrm")

    def asset_return_request(self):
        return self._run("asset")

    def exit_clearance(self):
        return self._run("clearance")

    def send_mail_offboarding(self, subject):
        return self._run("send_mail", subject=subject)


class FakeServiceNow:
    def __init__(self):
        self.created, self.resolved = [], []
        self.order = None

    def create_incident(self, short, description, category="inquiry"):
        self.created.append(short)
        n = len(self.created)
        return SimpleNamespace(number=f"INC{n:04d}", sys_id=f"sys{n}", url=f"https://sn/{n}")

    def resolve_incident(self, sys_id, note):
        self.resolved.append(sys_id)


class FakeOffice365:
    def __init__(self):
        self.calls = []

    def offboard_user(self, upn):
        self.calls.append(upn)
        return {"userId": "u1", "displayName": "X", "signInBlocked": True, "sessionsRevoked": True, "licencesRemoved": 2, "adminUrl": "x"}


class FakeOrangeHRM:
    def __init__(self):
        self.fail_times = 0
        self.calls = 0

    def terminate_employee(self, emp_number, name, last_day, note):
        self.calls += 1
        if self.fail_times:
            self.fail_times -= 1
            raise IntegrationError("OrangeHRM", "unreachable")
        return {"empNumber": emp_number, "terminationDate": last_day, "profileUrl": "x"}


@pytest.fixture
def world(client):
    container = client.app.state.container
    employee = Employee(
        id="EMP-111111", full_name="Aarav Sharma", email="aarav.personal@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
        aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
        job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook",
        status=EmployeeStatus.APPROVED,
        office365=Office365Info(user_principal_name="aarav.sharma@contoso.com"),
        orange_hrm=OrangeHrmInfo(emp_number=77, work_email="aarav.sharma@contoso.com"),
    )
    container.repository.add(employee)
    gw = container.offboarding._gw
    gw.servicenow, gw.office365, gw.orangehrm = FakeServiceNow(), FakeOffice365(), FakeOrangeHRM()
    gw.automationedge = FakeAE([])
    return client, gw, employee


def resignation(**over):
    body = {"employeeRef": "EMP-111111", "lastWorkingDay": (date.today() + timedelta(days=20)).isoformat(), "reason": "Better opportunity", "leaveBalanceDays": 5}
    return {**body, **over}


def test_lookup_by_id_and_by_work_email(world):
    client, _, _ = world
    for ref in ("emp-111111", "Aarav.Sharma@contoso.com", "aarav.personal@example.com"):
        body = client.get("/api/offboardings/lookup", params={"ref": ref}).json()
        assert body["fullName"] == "Aarav Sharma" and body["workEmail"] == "aarav.sharma@contoso.com"
    assert client.get("/api/offboardings/lookup", params={"ref": "nobody@x.com"}).status_code == 404


def test_only_approved_employees_can_resign(world):
    client, _, _ = world
    client.app.state.container.repository.update("EMP-111111", lambda e: setattr(e, "status", EmployeeStatus.PENDING_REVIEW))
    assert client.get("/api/offboardings/lookup", params={"ref": "EMP-111111"}).status_code == 409


def test_past_last_day_is_rejected(world):
    client, _, _ = world
    response = client.post("/api/offboardings", json=resignation(lastWorkingDay=(date.today() - timedelta(days=1)).isoformat()))
    assert response.status_code == 422


def test_full_offboarding_run(world):
    client, gw, _ = world
    created = client.post("/api/offboardings", json=resignation()).json()
    oid = created["id"]
    assert created["status"] == "Pending Review" and created["noticePeriodDays"] == 30
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    # a second resignation for the same person is refused
    assert client.post("/api/offboardings", json=resignation()).status_code == 409
    assert client.get("/api/offboardings/lookup", params={"ref": "EMP-111111"}).status_code == 409

    assert client.post(f"/api/offboardings/{oid}/approve").status_code == 202
    done = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == "Completed" and r)
    steps = {s["key"]: s for s in done["pipeline"]}
    assert [s["status"] for s in done["pipeline"]] == ["success"] * 9
    # every workflow ran, strictly in this order (each only after the previous one completed)
    assert gw.automationedge.order == ["exit_details", "exit_approval", "ad_disable", "o365", "orangehrm", "asset", "clearance", "send_mail"]
    assert gw.automationedge.params["send_mail"] == {"subject": "Relieving Letter - Aarav Sharma"}
    assert gw.automationedge.params["ad_disable"] == {"P_firstName": "Aarav", "P_lastName": "Sharma", "P_receiverEmailID": "aarav.personal@example.com"}
    assert steps["ad_disable"]["details"]["workflows"][0]["status"] == "Complete"
    assert steps["o365_block"]["details"]["licencesRemoved"] == 2 and gw.office365.calls == ["aarav.sharma@contoso.com"]
    assert steps["settlement"]["details"]["netPayable"] > 0
    assert len(gw.servicenow.created) == 3 and gw.servicenow.resolved == ["sys1"]  # umbrella, asset, clearances; umbrella resolved
    assert done["relievingLetter"]["filename"].startswith("Relieving_Letter_")
    pdf = client.get(f"/api/offboardings/{oid}/relieving-letter")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert client.post(f"/api/offboardings/{oid}/approve").status_code == 409


def test_failed_step_stops_the_chain_and_rerun_resumes(world):
    client, gw, _ = world
    gw.orangehrm.fail_times = 1
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    client.post(f"/api/offboardings/{oid}/approve")
    failed = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == OffboardingStatus.FAILED.value and r)
    statuses = [s["status"] for s in failed["pipeline"]]
    assert statuses == ["success", "success", "success", "failed", "skipped", "skipped", "skipped", "skipped", "skipped"]
    assert "unreachable" in failed["pipeline"][3]["message"]

    assert client.post(f"/api/offboardings/{oid}/retry").status_code == 202
    done = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == "Completed" and r)
    assert [s["status"] for s in done["pipeline"]] == ["success"] * 9
    assert gw.office365.calls == ["aarav.sharma@contoso.com"]  # the step that had succeeded was not repeated
    assert gw.orangehrm.calls == 2


def test_reject_resolves_the_ticket_and_frees_the_employee(world):
    client, gw, _ = world
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    assert client.post(f"/api/offboardings/{oid}/reject").json()["status"] == "Rejected"
    assert gw.servicenow.resolved == ["sys1"]
    assert client.get("/api/offboardings/lookup", params={"ref": "EMP-111111"}).status_code == 200


def test_runs_without_any_credentials_skipping_the_systems(client, world):
    """The real clients have no credentials here: systems are skipped (not failed) and the rest still runs."""
    client, gw, _ = world
    from app.integrations.automationedge import AutomationEdgeClient
    from app.integrations.office365 import Office365Client
    from app.integrations.orangehrm import OrangeHRMClient
    from app.integrations.servicenow import ServiceNowClient

    settings = gw.settings
    gw.servicenow, gw.office365, gw.orangehrm = ServiceNowClient(settings), Office365Client(settings), OrangeHRMClient(settings)
    gw.automationedge = AutomationEdgeClient(settings)
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    client.post(f"/api/offboardings/{oid}/approve")
    done = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == "Completed" and r)
    by_key = {s["key"]: s["status"] for s in done["pipeline"]}
    assert by_key["o365_block"] == "skipped" and by_key["hrm_terminate"] == "skipped" and by_key["settlement"] == "success"
    assert by_key["ad_disable"] == "skipped" and by_key["exit_approval"] == "skipped"  # no AutomationEdge credentials


def test_a_failed_workflow_stops_the_chain_and_blocks_its_backend_call(world):
    client, gw, _ = world
    gw.automationedge.fail.add("ad_disable")
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    client.post(f"/api/offboardings/{oid}/approve")
    failed = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == OffboardingStatus.FAILED.value and r)
    assert [s["status"] for s in failed["pipeline"]] == ["success", "failed"] + ["skipped"] * 7
    assert gw.automationedge.order == ["exit_details", "exit_approval", "ad_disable"]  # nothing after the failed workflow started
    assert gw.office365.calls == []


def test_o365_backend_call_waits_for_its_workflow(world):
    client, gw, _ = world
    gw.automationedge.fail.add("o365")
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    client.post(f"/api/offboardings/{oid}/approve")
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["status"] == OffboardingStatus.FAILED.value)
    assert gw.office365.calls == []  # the workflow failed, so the Microsoft Graph call was never made

    gw.automationedge.fail.clear()
    client.post(f"/api/offboardings/{oid}/retry")
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["status"] == "Completed")
    assert gw.office365.calls == ["aarav.sharma@contoso.com"]


def test_a_failed_exit_details_workflow_fails_the_intake(world):
    client, gw, _ = world
    gw.automationedge.fail.add("exit_details")
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    record = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["intakeStatus"] == "failed" and r)
    assert client.post(f"/api/offboardings/{oid}/approve").status_code == 409
    gw.automationedge.fail.clear()
    assert client.post(f"/api/offboardings/{oid}/retry-intake").status_code == 202
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")


def test_a_failed_step_can_be_skipped_and_the_chain_carries_on(world):
    client, gw, _ = world
    gw.orangehrm.fail_times = 99  # OrangeHRM stays down
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "completed")
    client.post(f"/api/offboardings/{oid}/approve")
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["status"] == OffboardingStatus.FAILED.value)

    assert client.post(f"/api/offboardings/{oid}/skip-step").status_code == 202
    done = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["status"] == "Completed" and r)
    statuses = {s["key"]: s for s in done["pipeline"]}
    assert statuses["hrm_terminate"]["status"] == "skipped" and statuses["hrm_terminate"]["details"]["skippedByUser"] is True
    assert all(s["status"] == "success" for k, s in statuses.items() if k != "hrm_terminate")
    assert gw.orangehrm.calls == 1  # the skipped step was not run again
    assert gw.office365.calls == ["aarav.sharma@contoso.com"]  # nothing before it was repeated
    assert client.post(f"/api/offboardings/{oid}/skip-step").status_code == 409  # nothing left to skip


def test_a_failed_intake_step_can_be_skipped(world):
    client, gw, _ = world
    gw.automationedge.fail.add("exit_details")
    oid = client.post("/api/offboardings", json=resignation()).json()["id"]
    wait_for(lambda: client.get(f"/api/offboardings/{oid}").json()["intakeStatus"] == "failed")
    assert client.post(f"/api/offboardings/{oid}/skip-intake-step").status_code == 202
    done = wait_for(lambda: (r := client.get(f"/api/offboardings/{oid}").json())["intakeStatus"] == "completed" and r)
    assert [s["status"] for s in done["intake"]] == ["success", "skipped"]
    assert client.post(f"/api/offboardings/{oid}/approve").status_code == 202

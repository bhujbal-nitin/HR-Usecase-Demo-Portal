"""Shared state passed through the provisioning steps."""

from dataclasses import dataclass, field

from app.core.config import Settings
from app.integrations.automationedge import AutomationEdgeClient, WorkflowResult
from app.integrations.office365 import Office365Client
from app.integrations.orangehrm import OrangeHRMClient
from app.integrations.servicenow import CatalogRequest, ServiceNowClient
from app.schemas.employee import (
    Employee,
    LaptopInfo,
    Office365Info,
    OrangeHrmInfo,
    WorkflowRun,
)
from app.services.document_store import DocumentStore

SERVICENOW_SOURCE = "ServiceNow Direct"
PORTAL_SOURCE = "HR Portal"


@dataclass
class Gateways:
    """Everything the steps need to talk to the outside world."""

    settings: Settings
    servicenow: ServiceNowClient
    automationedge: AutomationEdgeClient
    office365: Office365Client
    orangehrm: OrangeHRMClient
    documents: DocumentStore


@dataclass
class PipelineContext:
    employee: Employee
    gateways: Gateways
    source: str = PORTAL_SOURCE

    # Results accumulated by the steps; copied onto the stored record after each step.
    effective_email: str = ""
    office365: Office365Info | None = None
    orange_hrm: OrangeHrmInfo | None = None
    laptop: LaptopInfo | None = None
    workflow_runs: list[WorkflowRun] = field(default_factory=list)
    sn_approval_status: str | None = None
    # Intake results: the ServiceNow request created at submit, or why it could not be.
    sn_request: CatalogRequest | None = None
    sn_state: str | None = None  # 'Not Synced' | 'Sync Failed'
    sn_error: str | None = None
    _persisted_runs: int = 0

    def __post_init__(self) -> None:
        self.effective_email = self.effective_email or self.employee.email

    def resume_from(self, employee: Employee) -> None:
        """Seed the context with what earlier (successful) steps already produced, for a retry from the failed step."""
        done = {s.key for s in employee.pipeline if s.status.value == "success"}
        self.office365, self.orange_hrm = employee.office365, employee.orange_hrm
        self.laptop = employee.laptop
        if employee.office365 and employee.office365.user_principal_name:
            self.effective_email = employee.office365.user_principal_name
        if "servicenow_approval" in done:
            self.sn_approval_status = employee.service_now.approval_status
        # Earlier workflow runs are already stored; keep them for the hardware-incident description only.
        earlier = [
            WorkflowRun(
                workflow_name=w["workflowName"], automation_request_id=w.get("requestId"), execution_status=w.get("status"),
                agent_name=w.get("agent"), message=w.get("message"), instance_url=w.get("url"),
            )
            for step in employee.pipeline if step.status.value == "success"
            for w in step.details.get("workflows", [])
        ]
        self.workflow_runs = earlier
        self._persisted_runs = len(earlier)

    def record_workflow(self, result: WorkflowResult) -> WorkflowResult:
        self.workflow_runs.append(result.to_run())
        return result

    def apply_to(self, employee: Employee) -> None:
        """Copy accumulated results onto the persisted record."""
        employee.workflow_runs.extend(self.workflow_runs[self._persisted_runs:])
        self._persisted_runs = len(self.workflow_runs)
        if self.sn_request:
            sn, request = employee.service_now, self.sn_request
            sn.req_number, sn.ritm_number = request.req_number, request.ritm_number
            sn.req_sys_id, sn.ritm_sys_id = request.req_sys_id, request.ritm_sys_id
            sn.req_url, sn.ritm_url = request.req_url, request.ritm_url
            sn.approval_status, sn.stage = "Pending Approval", "HR Document Verification"
            sn.attached_documents = request.attached
            sn.sync_error = "; ".join(request.warnings) or None
        elif self.sn_state:
            employee.service_now.approval_status = self.sn_state
            employee.service_now.sync_error = self.sn_error
        if self.sn_approval_status:
            employee.service_now.approval_status = self.sn_approval_status
            employee.service_now.stage = "Approved - Provisioning"
        employee.office365 = self.office365 or employee.office365
        employee.orange_hrm = self.orange_hrm or employee.orange_hrm
        employee.laptop = self.laptop or employee.laptop

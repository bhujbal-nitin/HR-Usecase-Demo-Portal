"""The ordered provisioning steps executed when HR approves a candidate.

Order (as in the original orchestrator):
  1. ServiceNow approval            5. OrangeHRM profile
  2. AutomationEdge mgmt approval   6. Laptop request + ServiceNow incident
  3. Active Directory account
  4. Microsoft 365 account
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.core.exceptions import IntegrationError
from app.schemas.employee import LaptopInfo, StepStatus
from app.services.pipeline.attempts import Attempts, StepOutcome
from app.services.pipeline.context import SERVICENOW_SOURCE, PipelineContext


@dataclass(frozen=True)
class Step:
    key: str
    label: str
    system: str
    run: Callable[[PipelineContext], StepOutcome]


def _workflow(ctx: PipelineContext, attempts: Attempts, label: str, call: Callable):
    """Run an AutomationEdge workflow; a finished-but-failed instance counts as a failure."""

    def action():
        result = ctx.record_workflow(call())
        attempts.details.setdefault("workflows", []).append({
            "workflowName": result.workflow_name,
            "requestId": result.automation_request_id,
            "status": result.execution_status,
            "agent": result.agent_name or None,
            "url": result.instance_url,
            "message": result.message,
            "response": result.response,
        })
        if not result.ok:
            raise IntegrationError(
                "AutomationEdge",
                f"'{result.workflow_name}' ended with status {result.execution_status}: {result.message}",
            )
        return result

    return attempts.run(label, action)


def _run_note(result) -> str:
    return f"request #{result.automation_request_id}" if result and result.automation_request_id else "dispatched"


# --------------------------------------------------------------------- steps
def servicenow_approval(ctx: PipelineContext) -> StepOutcome:
    emp, sn = ctx.employee, ctx.gateways.servicenow
    if ctx.source == SERVICENOW_SOURCE:
        ctx.sn_approval_status = "Approved"
        return StepOutcome(StepStatus.SUCCESS, "Request was approved directly inside ServiceNow.")
    if not emp.service_now.req_sys_id:
        return StepOutcome(StepStatus.SKIPPED, "No ServiceNow request is linked to this candidate.")
    attempts = Attempts()
    attempts.run("Approve request", lambda: sn.approve_request(emp.service_now.req_sys_id))
    outcome = attempts.outcome(f"Request {emp.service_now.req_number or ''} approved".strip())
    if outcome.status == StepStatus.SUCCESS:
        ctx.sn_approval_status = "Approved"
    return outcome


def management_approval(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    result = _workflow(ctx, attempts, "T4 management approval workflow", ctx.gateways.automationedge.management_approval)
    return attempts.outcome(f"Management approval workflow completed ({_run_note(result)})")


def active_directory(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    ae, emp = ctx.gateways.automationedge, ctx.employee
    result = _workflow(ctx, attempts, "T4 Active Directory workflow", lambda: ae.create_ad_user(emp, emp.email))
    return attempts.outcome(f"Active Directory account workflow completed ({_run_note(result)})")


def office365(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    gw, emp = ctx.gateways, ctx.employee
    _workflow(ctx, attempts, "T4 Microsoft 365 workflow", gw.automationedge.create_o365_user)
    info = attempts.run("Entra ID account (Microsoft Graph)", lambda: gw.office365.create_user(emp))
    if info:
        ctx.office365 = info
        ctx.effective_email = info.user_principal_name or ctx.effective_email
        attempts.details["userPrincipalName"] = info.user_principal_name
    return attempts.outcome(f"Microsoft 365 account ready: {ctx.effective_email}")


def orangehrm(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    gw, emp = ctx.gateways, ctx.employee
    _workflow(ctx, attempts, "T4 OrangeHRM workflow", lambda: gw.automationedge.add_emp_orangehrm(emp))

    def create_profile():
        result = gw.orangehrm.create_employee_profile(emp, ctx.effective_email, _document_payloads(ctx))
        attempts.details["warnings"] = result.warnings
        attempts.details["notes"] = result.notes
        return result

    profile = attempts.run("OrangeHRM PIM profile", create_profile)
    if profile:
        ctx.orange_hrm = profile.info
        if profile.warnings:
            attempts.failed.append(f"profile created with gaps: {'; '.join(profile.warnings)}")
    number = profile.info.emp_number if profile else None
    return attempts.outcome(f"OrangeHRM profile #{number} created with work e-mail {ctx.effective_email}")


def laptop(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    gw, emp = ctx.gateways, ctx.employee
    _workflow(ctx, attempts, "T4 laptop request workflow", lambda: gw.automationedge.create_laptop_request(emp))

    description = _incident_description(ctx)
    emp_number = ctx.orange_hrm.emp_number if ctx.orange_hrm else None
    incident = attempts.run("ServiceNow hardware incident", lambda: gw.servicenow.create_hardware_incident(emp, description, emp_number))
    if incident:
        ctx.laptop = LaptopInfo(ticket_number=incident.number, ticket_url=incident.url, hardware=emp.hardware)
    return attempts.outcome(f"Laptop requested; incident {incident.number if incident else ''}".strip())


# --------------------------------------------------------------------- helpers
def _document_payloads(ctx: PipelineContext) -> list[tuple[str, bytes, str]]:
    """The candidate's uploaded documents as (filename, bytes, content-type)."""
    emp, store = ctx.employee, ctx.gateways.documents
    return [(doc.filename, store.read(emp.id, doc), doc.content_type) for doc in emp.documents.values()]


def _incident_description(ctx: PipelineContext) -> str:
    emp = ctx.employee
    lines = [
        f"Employee onboarding and multi-system provisioning for {emp.full_name} ({emp.id}).",
        "",
        f"ServiceNow request: {emp.service_now.req_number or 'n/a'} [{ctx.sn_approval_status or 'n/a'}]",
        "AutomationEdge T4 workflows:",
    ]
    lines += [
        f"  - {run.workflow_name}: {run.execution_status} (request #{run.automation_request_id})"
        for run in ctx.workflow_runs
    ]
    lines += [
        "",
        f"Corporate e-mail: {ctx.effective_email}",
        f"OrangeHRM profile: #{ctx.orange_hrm.emp_number}" if ctx.orange_hrm else "OrangeHRM profile: not created",
        "",
        f"Hardware to deploy: {emp.hardware}",
        f"Delivery address: {emp.address}",
        "",
        "Please image the standard corporate OS, configure security profiles and dispatch the device.",
    ]
    return "\n".join(lines)


PROVISIONING_STEPS: list[Step] = [
    Step("servicenow_approval", "ServiceNow request approval", "ServiceNow", servicenow_approval),
    Step("management_approval", "Management approval workflow", "AutomationEdge", management_approval),
    Step("active_directory", "Active Directory account", "AutomationEdge", active_directory),
    Step("office365", "Microsoft 365 account", "Microsoft 365", office365),
    Step("orangehrm", "OrangeHRM employee profile", "OrangeHRM", orangehrm),
    Step("laptop", "Laptop request & hardware incident", "ServiceNow", laptop),
]

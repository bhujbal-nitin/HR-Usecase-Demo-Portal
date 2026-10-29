"""The offboarding chains: AutomationEdge workflows plus the backend's own API calls, strictly one after another.

Intake (right after the resignation is submitted): the umbrella ServiceNow ticket, then "HR Demo Get Exit Details".
Offboarding (after HR approves): exit approval, access removal, asset return, clearances, settlement, relieving letter, close-out.
A workflow must reach 'Complete' before the next step starts; where a step also makes a backend call (Microsoft 365,
OrangeHRM, ServiceNow) that call only happens after its workflow succeeded.
A step whose system has no credentials is skipped (not failed); the chain stops at the first real failure.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from app.core.config import Settings
from app.core.exceptions import IntegrationError
from app.integrations.automationedge import AutomationEdgeClient
from app.integrations.mailer import Mailer
from app.integrations.office365 import Office365Client
from app.integrations.orangehrm import OrangeHRMClient
from app.integrations.servicenow import ServiceNowClient
from app.schemas.employee import StepStatus
from app.schemas.offboarding import Offboarding
from app.services.offboarding import settlement as settlement_rules
from app.services.offboarding.relieving_letter_service import RelievingLetterService
from app.services.pipeline.attempts import Attempts, StepOutcome


@dataclass
class OffboardingGateways:
    settings: Settings
    servicenow: ServiceNowClient
    automationedge: AutomationEdgeClient
    office365: Office365Client
    orangehrm: OrangeHRMClient
    mailer: Mailer
    letters: RelievingLetterService


@dataclass
class OffboardingContext:
    record: Offboarding
    gateways: OffboardingGateways
    results: dict[str, dict] = field(default_factory=dict)  # step key -> details of the steps that already succeeded


@dataclass(frozen=True)
class OffboardingStep:
    key: str
    label: str
    system: str
    run: Callable[[OffboardingContext], StepOutcome]


def _workflow(attempts: Attempts, label: str, call: Callable):
    """Run an AutomationEdge workflow and wait for it; a finished-but-not-Complete instance counts as a failure."""

    def action():
        result = call()
        attempts.details.setdefault("workflows", []).append({
            "workflowName": result.workflow_name, "requestId": result.automation_request_id, "status": result.execution_status,
            "agent": result.agent_name or None, "url": result.instance_url, "message": result.message, "response": result.response,
        })
        if not result.ok:
            raise IntegrationError("AutomationEdge", f"'{result.workflow_name}' ended with status {result.execution_status}: {result.message}")
        return result

    return attempts.run(label, action)


def _description(ctx: OffboardingContext, what: str) -> str:
    r = ctx.record
    return (
        f"{what}\n\nEmployee: {r.full_name} ({r.employee_id})\nDepartment: {r.department}\nManager: {r.manager}\n"
        f"Last working day: {r.last_working_day.isoformat()}\nOffboarding reference: {r.id}"
    )


# ---------------------------------------------------------------- intake
def servicenow_ticket(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    incident = attempts.run("Create the offboarding ticket", lambda: ctx.gateways.servicenow.create_incident(
        f"Employee offboarding: {r.full_name} ({r.employee_id}), last day {r.last_working_day.isoformat()}",
        _description(ctx, f"Resignation received. Reason: {r.reason}. {r.comments}".strip()),
    ))
    if incident:
        attempts.details.update({"ticket": incident.number, "sysId": incident.sys_id, "url": incident.url})
    return attempts.outcome(f"Ticket {incident.number if incident else ''} created".strip())


def exit_details(ctx: OffboardingContext) -> StepOutcome:
    attempts = Attempts()
    result = _workflow(attempts, "HR Demo Get Exit Details workflow", ctx.gateways.automationedge.get_exit_details)
    return attempts.outcome(f"Exit details workflow completed ({_run_note(result)})")


def _run_note(result) -> str:
    return f"request #{result.automation_request_id}" if result and result.automation_request_id else "dispatched"


# ----------------------------------------------------------- offboarding
def exit_approval(ctx: OffboardingContext) -> StepOutcome:
    attempts = Attempts()
    result = _workflow(attempts, "HR Demo Exit Management Approval workflow", ctx.gateways.automationedge.exit_management_approval)
    return attempts.outcome(f"Exit management approval workflow completed ({_run_note(result)})")


def active_directory(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    parts = r.full_name.split()
    first, last = (parts[0], parts[-1]) if parts else ("Employee", "Employee")
    result = _workflow(
        attempts, "HR Demo AD user disable workflow",
        lambda: ctx.gateways.automationedge.disable_ad_user(first, last, r.personal_email),
    )
    return attempts.outcome(f"Active Directory account disabled ({_run_note(result)})")


def office365(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    if not r.user_principal_name:
        return StepOutcome(StepStatus.SKIPPED, "No Microsoft 365 account is recorded for this employee.")
    _workflow(attempts, "HR Demo O365 User Offboarding workflow", ctx.gateways.automationedge.offboard_o365_user)
    if attempts.failed:
        return attempts.outcome()
    info = attempts.run("Block sign-in, revoke sessions, remove licences", lambda: ctx.gateways.office365.offboard_user(r.user_principal_name))
    if info:
        attempts.details.update(info)
    removed = info["licencesRemoved"] if info else 0
    return attempts.outcome(f"{r.user_principal_name}: sign-in blocked, sessions revoked, {removed} licence(s) removed")


def orangehrm(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    _workflow(attempts, "HR Demo Terminate emp OrangeHRM workflow", ctx.gateways.automationedge.terminate_emp_orangehrm)
    if attempts.failed:
        return attempts.outcome()
    info = attempts.run("End the employment in OrangeHRM", lambda: ctx.gateways.orangehrm.terminate_employee(
        r.emp_number, r.full_name, r.last_working_day.isoformat(), f"Resigned: {r.reason}. {r.comments}".strip(),
    ))
    if info:
        attempts.details.update(info)
    return attempts.outcome(f"Employment ended on {r.last_working_day.isoformat()} (OrangeHRM #{info['empNumber'] if info else ''})")


def asset_return(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    _workflow(attempts, "HR Demo Asset Return Request workflow", ctx.gateways.automationedge.asset_return_request)
    if attempts.failed:
        return attempts.outcome()
    incident = attempts.run("Create the asset-return ticket", lambda: ctx.gateways.servicenow.create_incident(
        f"Asset return: {r.hardware} from {r.full_name} ({r.employee_id})",
        _description(ctx, f"Collect {r.hardware} and any accessories on or before the last working day, wipe it and return it to stock."),
        category="Hardware",
    ))
    if incident:
        attempts.details.update({"ticket": incident.number, "url": incident.url, "asset": r.hardware})
    return attempts.outcome(f"Asset-return ticket {incident.number if incident else ''} created".strip())


def clearances(ctx: OffboardingContext) -> StepOutcome:
    r, attempts = ctx.record, Attempts()
    departments = ["IT", "Finance", "Admin"]
    _workflow(attempts, "HR Demo Exit Clearance workflow", ctx.gateways.automationedge.exit_clearance)
    if attempts.failed:
        return attempts.outcome()
    incident = attempts.run("Create the clearance ticket", lambda: ctx.gateways.servicenow.create_incident(
        f"No-dues clearance: {r.full_name} ({r.employee_id})",
        _description(ctx, "No-dues clearance is required from: " + ", ".join(departments) + "."),
    ))
    if incident:
        attempts.details.update({"ticket": incident.number, "url": incident.url, "departments": departments})
    return attempts.outcome(f"Clearance ticket {incident.number if incident else ''} created for {', '.join(departments)}".strip())


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(w.capitalize() for w in rest)


def settlement(ctx: OffboardingContext) -> StepOutcome:
    r, s = ctx.record, ctx.gateways.settings
    result = settlement_rules.calculate(
        r.annual_ctc, r.resignation_date, r.last_working_day, r.notice_period_days, r.leave_balance_days, s.offboarding_basic_share,
    ).as_dict()
    return StepOutcome(
        StepStatus.SUCCESS, f"Final settlement calculated: net payable INR {result['net_payable']:,}.",
        {**{_camel(k): v for k, v in result.items()}, "rules": list(settlement_rules.RULES)},
    )


def relieving_letter(ctx: OffboardingContext) -> StepOutcome:
    r, attempts, letters = ctx.record, Attempts(), ctx.gateways.letters
    figures = ctx.results.get("settlement")
    if not figures:
        return StepOutcome(StepStatus.FAILED, "The settlement figures are missing; run the settlement step first.")
    pdf = attempts.run("Generate the relieving letter", lambda: letters.generate_pdf(r, figures))
    if pdf:
        attempts.details["filename"] = pdf.name
        recipient = attempts.run("E-mail the relieving letter", lambda: letters.send_email(r, pdf))
        attempts.details["emailed"], attempts.details["recipient"] = bool(recipient), recipient
        _workflow(attempts, "HR Demo Send mail Offboarding workflow", lambda: ctx.gateways.automationedge.send_mail_offboarding(f"Relieving Letter - {r.full_name}"))
    return attempts.outcome(f"Relieving letter {pdf.name if pdf else ''} generated".strip())


def servicenow_close(ctx: OffboardingContext) -> StepOutcome:
    attempts = Attempts()
    ticket = ctx.results.get("servicenow_ticket", {})
    if not ticket.get("sysId"):
        return StepOutcome(StepStatus.SKIPPED, "No ServiceNow ticket is linked to this offboarding.")
    attempts.run("Resolve the offboarding ticket", lambda: ctx.gateways.servicenow.resolve_incident(
        ticket["sysId"], "Offboarding completed: access removed, assets and clearances raised, relieving letter sent.",
    ))
    return attempts.outcome(f"Ticket {ticket.get('ticket', '')} resolved".strip())


INTAKE_STEPS = [
    OffboardingStep("servicenow_ticket", "ServiceNow offboarding ticket", "ServiceNow", servicenow_ticket),
    OffboardingStep("exit_details", "Exit details workflow", "AutomationEdge", exit_details),
]

OFFBOARDING_STEPS = [
    OffboardingStep("exit_approval", "Exit management approval", "AutomationEdge", exit_approval),
    OffboardingStep("ad_disable", "Disable the Active Directory account", "AutomationEdge", active_directory),
    OffboardingStep("o365_block", "Block the Microsoft 365 account", "Microsoft 365", office365),
    OffboardingStep("hrm_terminate", "End the employment in OrangeHRM", "OrangeHRM", orangehrm),
    OffboardingStep("asset_return", "Raise the asset-return ticket", "ServiceNow", asset_return),
    OffboardingStep("clearances", "Raise the department clearances", "ServiceNow", clearances),
    OffboardingStep("settlement", "Calculate the final settlement", "Backend", settlement),
    OffboardingStep("relieving_letter", "Send the relieving letter", "E-mail", relieving_letter),
    OffboardingStep("servicenow_close", "Close the ServiceNow ticket", "ServiceNow", servicenow_close),
]

"""Intake chain, run in the background right after a candidate is submitted.

  1. ServiceNow request (with the documents attached)
  2. AutomationEdge workflow "HR Demo Get Employee Details" - must reach Complete before anything else happens

The chain stops at the first real failure; a system without credentials is *skipped* (not a failure).
"""

from app.integrations.servicenow import Attachment
from app.schemas.employee import StepStatus
from app.services.pipeline.attempts import Attempts, StepOutcome
from app.services.pipeline.context import PipelineContext
from app.services.pipeline.steps import Step, _run_note, _workflow


def servicenow_request(ctx: PipelineContext) -> StepOutcome:
    emp, gw = ctx.employee, ctx.gateways
    attempts = Attempts()

    def create():
        attachments = [Attachment(d.filename, gw.documents.read(emp.id, d), d.content_type) for d in emp.documents.values()]
        return gw.servicenow.create_onboarding_request(emp, attachments)

    request = attempts.run("Create ServiceNow request", create)
    if request:
        ctx.sn_request = request
        attempts.details["warnings"] = request.warnings
        return attempts.outcome(f"Request {request.req_number} created with {len(request.attached)} document(s) attached")

    outcome = attempts.outcome()
    ctx.sn_state = "Not Synced" if outcome.status == StepStatus.SKIPPED else "Sync Failed"
    ctx.sn_error = outcome.message
    return outcome


def candidate_details(ctx: PipelineContext) -> StepOutcome:
    attempts = Attempts()
    result = _workflow(ctx, attempts, "T4 candidate-details workflow", lambda: ctx.gateways.automationedge.get_emp_details(ctx.employee))
    message = f"Candidate-details workflow completed ({_run_note(result)})"
    if result and result.message:
        message += f": {result.message}"
    return attempts.outcome(message)


INTAKE_STEPS: list[Step] = [
    Step("servicenow_request", "ServiceNow request", "ServiceNow", servicenow_request),
    Step("candidate_details", "Candidate details workflow", "AutomationEdge", candidate_details),
]

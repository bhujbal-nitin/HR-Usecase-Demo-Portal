"""Running one AutomationEdge showcase workflow for an endpoint: ``POST /<agent>/workflows/{key}``."""

from fastapi import HTTPException

from app.container import Container
from app.schemas.leave import LeaveWorkflowRun


def run_showcase_workflow(container: Container, methods: dict[str, str], key: str) -> LeaveWorkflowRun:
    """Run the workflow behind ``key`` (``methods`` maps the URL key to the AutomationEdge client method) and wait until it finishes.

    Without AutomationEdge credentials this raises the usual 502, so the chat step fails and offers Rerun / Skip; a workflow that does
    not end Complete comes back with ``ok: false``. An unknown key is a 404.
    """
    method = methods.get(key)
    if method is None:
        raise HTTPException(status_code=404, detail=f"Unknown workflow '{key}'.")
    result = getattr(container.automationedge, method)()
    return LeaveWorkflowRun(
        workflow_name=result.workflow_name, status=result.execution_status, ok=result.ok, automation_request_id=result.automation_request_id,
        agent=result.agent_name or None, message=result.message, instance_url=result.instance_url,
    )

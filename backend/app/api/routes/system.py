"""Health, demo-data and background-task endpoints."""

from fastapi import APIRouter

from app.api.deps import AutofillDep, HealthDep, SettingsDep, TaskQueueDep
from app.core.exceptions import NotFoundError
from app.schemas.employee import AutofillProfile
from app.services.health_service import SystemHealth

router = APIRouter(tags=["system"])


@router.get("/health")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/integrations/health", response_model=dict[str, SystemHealth])
def integrations_health(service: HealthDep):
    """Live connectivity check against ServiceNow, AutomationEdge, Microsoft 365 and OrangeHRM."""
    return service.check_all()


@router.get("/autofill", response_model=AutofillProfile)
def autofill(service: AutofillDep):
    """A unique sample candidate for the wizard's Auto-Fill button."""
    return service.generate()


@router.get("/demo-config")
def demo_config(settings: SettingsDep):
    """Pacing for the agent demo pages, taken from the DEMO_* settings in .env."""

    def pacing(prefix: str) -> dict[str, float | int]:
        return {
            "stepScale": max(0.1, getattr(settings, f"demo_{prefix}_step_scale")),
            "messageGapMs": max(0, getattr(settings, f"demo_{prefix}_message_gap_ms")),
            "phaseGapMs": max(0, getattr(settings, f"demo_{prefix}_phase_gap_ms")),
        }

    return {
        "simulated": {**pacing("simulated"), "approvalWaitMs": max(0, settings.demo_simulated_approval_wait_ms)},
        "live": pacing("live"),
    }


@router.get("/tasks")
def list_tasks(queue: TaskQueueDep):
    return {"metrics": queue.get_metrics(), "tasks": queue.list_tasks(limit=50)}


@router.get("/tasks/{task_id}")
def get_task(task_id: str, queue: TaskQueueDep):
    task = queue.get_task(task_id)
    if task is None:
        raise NotFoundError(f"Task {task_id} was not found.")
    return task

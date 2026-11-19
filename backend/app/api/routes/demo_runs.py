"""Demo history: the portal tells the backend when a signed-in user starts a demo and how it ends (an admin reads the list under /admin/demo-runs)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.deps import ContainerDep

router = APIRouter(prefix="/demo-runs", tags=["demo-runs"])


class RunStart(BaseModel):
    agent: str = Field(pattern=r"^[a-z0-9_]{1,40}$")
    mode: Literal["live", "simulated"]
    manual: bool = False


class RunEnd(BaseModel):
    outcome: Literal["completed", "stopped", "failed"]
    detail: str = Field(default="", max_length=500)


@router.post("")
def start_run(data: RunStart, container: ContainerDep) -> dict:
    """A demo was started. Returns ``{id}`` (``id`` is null when history is not being kept)."""
    return {"id": container.demo_runs.start(data.agent, data.mode, data.manual)}


@router.post("/{run_id}/finish")
def finish_run(run_id: int, data: RunEnd, container: ContainerDep) -> dict:
    """The demo ended. Only the user who started it can close it, and only once."""
    return {"closed": container.demo_runs.finish(run_id, data.outcome, data.detail)}

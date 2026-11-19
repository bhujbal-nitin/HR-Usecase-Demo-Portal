"""Demo history: which signed-in user ran which demo, in which mode, when it started and how it ended."""

import logging

from app.core.request_context import NO_LOGIN, current_user
from app.repositories.demo_run_repository import DemoRunRepository

logger = logging.getLogger(__name__)


class DemoRunService:
    def __init__(self, repository: DemoRunRepository):
        self._repository = repository

    def start_schema(self) -> None:
        try:
            self._repository.ensure_schema()
        except Exception as exc:  # noqa: BLE001 - a database that is down must not stop the portal
            logger.error("Demo history table is not ready: %s", exc)

    def start(self, agent: str, mode: str, manual: bool) -> int | None:
        """Note that the current user started a demo. Returns its id, or None when nothing could be recorded. Never raises."""
        user = current_user.get() or NO_LOGIN
        try:
            return self._repository.start(user, agent, mode, manual)
        except Exception as exc:  # noqa: BLE001
            logger.error("Demo run of %s (%s) was not saved: %s", user, agent, exc)
            return None

    def finish(self, run_id: int, outcome: str, detail: str) -> bool:
        """Note how the current user's run ended. Never raises."""
        user = current_user.get() or NO_LOGIN
        try:
            return self._repository.finish(run_id, user, outcome, detail.strip()[:300])
        except Exception as exc:  # noqa: BLE001
            logger.error("Demo run %s of %s was not closed: %s", run_id, user, exc)
            return False

    def history(self, username: str | None, agent: str | None, limit: int, offset: int) -> dict:
        rows, total = self._repository.history(username, agent, limit, offset)
        items = []
        for r in rows:
            started, ended = r["started_at"], r["ended_at"]
            items.append({
                "id": r["id"], "username": r["username"], "agent": r["agent"], "mode": r["mode"], "manual": r["manual"],
                "startedAt": started.isoformat(), "endedAt": ended.isoformat() if ended else None,
                "seconds": round((ended - started).total_seconds()) if ended else None,
                "outcome": r["outcome"], "detail": r["detail"] or "",
            })
        return {"items": items, "total": total}

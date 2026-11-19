"""Token tracking: every AI call is recorded against the signed-in user who caused it."""

import logging

from app.core.request_context import NO_LOGIN, current_feature, current_user
from app.repositories.usage_repository import UsageCall, UsageRepository

logger = logging.getLogger(__name__)


class UsageService:
    def __init__(self, repository: UsageRepository):
        self._repository = repository

    def start(self) -> None:
        try:
            self._repository.ensure_schema()
        except Exception as exc:  # noqa: BLE001 - a database that is down must not stop the portal
            logger.error("Token tracking table is not ready: %s", exc)

    def record(self, model: str, input_tokens: int, output_tokens: int, total_tokens: int | None = None) -> None:
        """Save one AI call for the user behind the current request. Never raises: tracking must not break the call itself."""
        call = UsageCall(
            username=current_user.get() or NO_LOGIN,
            feature=current_feature.get(),
            model=model,
            input_tokens=max(int(input_tokens), 0),
            output_tokens=max(int(output_tokens), 0),
            total_tokens=max(int(total_tokens if total_tokens is not None else input_tokens + output_tokens), 0),
        )
        try:
            self._repository.record(call)
        except Exception as exc:  # noqa: BLE001
            logger.error("Token usage of %s was not saved: %s", call.username, exc)

    def totals(self, days: int | None = None) -> list[dict]:
        return self._repository.totals(days)

    def history(self, username: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
        return self._repository.history(username, limit, offset)

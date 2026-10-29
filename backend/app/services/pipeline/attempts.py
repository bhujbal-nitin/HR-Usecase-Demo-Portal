"""Collects the outcome of the sub-actions inside one pipeline step."""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.schemas.employee import StepStatus

logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass
class StepOutcome:
    status: StepStatus
    message: str
    details: dict[str, Any] = field(default_factory=dict)


class Attempts:
    """Run several independent sub-actions; one failing must not hide the others."""

    def __init__(self) -> None:
        self.succeeded: list[str] = []
        self.failed: list[str] = []
        self.skipped: list[str] = []
        self.details: dict[str, Any] = {}

    def run(self, label: str, action: Callable[[], T]) -> T | None:
        try:
            value = action()
        except IntegrationNotConfiguredError as exc:
            self.skipped.append(f"{label} ({exc.system} not configured)")
            return None
        except IntegrationError as exc:
            logger.warning("%s failed: %s", label, exc)
            self.failed.append(f"{label}: {exc.message}")
            return None
        except Exception as exc:  # noqa: BLE001 - a bug in one sub-action must not abort provisioning
            logger.exception("%s crashed", label)
            self.failed.append(f"{label}: unexpected error ({exc})")
            return None
        self.succeeded.append(label)
        return value

    def outcome(self, success_message: str = "") -> StepOutcome:
        parts = [*self.failed, *(f"skipped - {s}" for s in self.skipped)]
        if self.failed:
            status = StepStatus.FAILED
            message = "; ".join(parts)
            if self.succeeded:
                message = f"Completed: {', '.join(self.succeeded)}. Failed: {message}"
        elif self.succeeded:
            status = StepStatus.SUCCESS
            message = success_message or f"Completed: {', '.join(self.succeeded)}"
            if self.skipped:
                message += f" (skipped: {', '.join(self.skipped)})"
        else:
            status = StepStatus.SKIPPED
            message = "; ".join(self.skipped) or "Nothing to do"
        return StepOutcome(status=status, message=message, details=self.details)

"""Background thread that notices approvals made directly inside ServiceNow."""

import logging
import threading

from app.services.onboarding_service import OnboardingService

logger = logging.getLogger(__name__)


class ApprovalPoller:
    def __init__(self, service: OnboardingService, interval_seconds: int):
        self._service = service
        self._interval = max(5, interval_seconds)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="servicenow-approval-poller", daemon=True)
        self._thread.start()
        logger.info("ServiceNow approval poller started (every %ss).", self._interval)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        # Initial delay lets the server finish starting before the first poll.
        while not self._stop.wait(self._interval):
            try:
                started = self._service.sync_servicenow_approvals()
                if started:
                    logger.info("ServiceNow poller started provisioning for %d candidate(s).", len(started))
            except Exception:  # noqa: BLE001 - the poller must survive any single failure
                logger.exception("ServiceNow approval poll failed")

"""Live connectivity checks for the four integrated systems."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

from app.core.exceptions import IntegrationNotConfiguredError
from app.schemas.common import CamelModel

CHECK_TIMEOUT_SECONDS = 15


class SystemHealth(CamelModel):
    ok: bool
    configured: bool
    message: str


class HealthService:
    def __init__(self, checks: dict[str, tuple[Callable[[], bool], Callable[[], str]]]):
        """``checks`` maps system key -> (is_configured, check_connection)."""
        self._checks = checks

    def check_all(self) -> dict[str, SystemHealth]:
        results: dict[str, SystemHealth] = {}
        pool = ThreadPoolExecutor(max_workers=len(self._checks) or 1)
        futures = {name: pool.submit(self._run, is_configured, check) for name, (is_configured, check) in self._checks.items()}
        for name, future in futures.items():
            try:
                results[name] = future.result(timeout=CHECK_TIMEOUT_SECONDS)
            except FutureTimeout:
                results[name] = SystemHealth(ok=False, configured=True, message="Timed out")
        pool.shutdown(wait=False, cancel_futures=True)
        return results

    @staticmethod
    def _run(is_configured: Callable[[], bool], check: Callable[[], str]) -> SystemHealth:
        if not is_configured():
            return SystemHealth(ok=False, configured=False, message="Not configured")
        try:
            return SystemHealth(ok=True, configured=True, message=check())
        except IntegrationNotConfiguredError:
            return SystemHealth(ok=False, configured=False, message="Not configured")
        except Exception as exc:  # noqa: BLE001 - report any failure as "unhealthy"
            return SystemHealth(ok=False, configured=True, message=str(exc)[:200])

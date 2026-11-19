"""Live connectivity checks for the integrated systems."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from datetime import datetime, timezone
import time

from app.core.exceptions import IntegrationNotConfiguredError
from app.schemas.common import CamelModel

CHECK_TIMEOUT_SECONDS = 15


class SystemHealth(CamelModel):
    ok: bool
    configured: bool
    message: str
    latency_ms: int | None = None
    endpoint: str | None = None
    identity: str | None = None
    checked_at: str | None = None


@dataclass
class CheckDef:
    name: str
    is_configured: Callable[[], bool]
    check: Callable[[], str]
    endpoint: str = ""
    identity: str = ""


class HealthService:
    def __init__(self, checks: dict[str, CheckDef | tuple[Callable[[], bool], Callable[[], str]]]):
        """``checks`` maps system key -> CheckDef or (is_configured, check_connection)."""
        normalized: dict[str, CheckDef] = {}
        for key, val in checks.items():
            if isinstance(val, CheckDef):
                normalized[key] = val
            elif isinstance(val, tuple) and len(val) == 2:
                normalized[key] = CheckDef(name=key, is_configured=val[0], check=val[1])
            else:
                raise ValueError(f"Invalid check definition for {key}")
        self._checks = normalized

    def check_all(self) -> dict[str, SystemHealth]:
        results: dict[str, SystemHealth] = {}
        pool = ThreadPoolExecutor(max_workers=len(self._checks) or 1)
        futures = {name: pool.submit(self._run, item) for name, item in self._checks.items()}
        for name, future in futures.items():
            item = self._checks[name]
            try:
                results[name] = future.result(timeout=CHECK_TIMEOUT_SECONDS)
            except FutureTimeout:
                results[name] = SystemHealth(
                    ok=False,
                    configured=True,
                    message="Connection timed out after 15 seconds",
                    endpoint=item.endpoint or None,
                    identity=item.identity or None,
                    checked_at=datetime.now(timezone.utc).isoformat(),
                )
        pool.shutdown(wait=False, cancel_futures=True)
        return results

    def check_one(self, system: str) -> SystemHealth | None:
        item = self._checks.get(system)
        if item is None:
            return None
        return self._run(item)

    @staticmethod
    def _run(item: CheckDef) -> SystemHealth:
        now_iso = datetime.now(timezone.utc).isoformat()
        if not item.is_configured():
            return SystemHealth(
                ok=False,
                configured=False,
                message="Not configured in .env",
                endpoint=item.endpoint or None,
                identity=item.identity or None,
                checked_at=now_iso,
            )
        start = time.perf_counter()
        try:
            msg = item.check()
            latency = int((time.perf_counter() - start) * 1000)
            return SystemHealth(
                ok=True,
                configured=True,
                message=msg or "Connected",
                latency_ms=latency,
                endpoint=item.endpoint or None,
                identity=item.identity or None,
                checked_at=now_iso,
            )
        except IntegrationNotConfiguredError:
            return SystemHealth(
                ok=False,
                configured=False,
                message="Not configured in .env",
                endpoint=item.endpoint or None,
                identity=item.identity or None,
                checked_at=now_iso,
            )
        except Exception as exc:  # noqa: BLE001 - report any failure as "unhealthy"
            latency = int((time.perf_counter() - start) * 1000)
            return SystemHealth(
                ok=False,
                configured=True,
                message=str(exc)[:300],
                latency_ms=latency,
                endpoint=item.endpoint or None,
                identity=item.identity or None,
                checked_at=now_iso,
            )


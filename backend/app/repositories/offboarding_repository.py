"""JSON-file persistence for offboarding records (same approach as the onboarding store)."""

import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.offboarding import Offboarding

logger = logging.getLogger(__name__)


class OffboardingRepository:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def list_all(self) -> list[Offboarding]:
        with self._lock:
            return self._load()

    def get(self, offboarding_id: str) -> Offboarding | None:
        with self._lock:
            return next((o for o in self._load() if o.id == offboarding_id), None)

    def require(self, offboarding_id: str) -> Offboarding:
        record = self.get(offboarding_id)
        if record is None:
            raise NotFoundError(f"Offboarding {offboarding_id} was not found.")
        return record

    def add(self, record: Offboarding) -> Offboarding:
        with self._lock:
            records = self._load()
            records.insert(0, record)
            self._save(records)
            return record

    def update(self, offboarding_id: str, mutator: Callable[[Offboarding], None]) -> Offboarding:
        """Apply ``mutator`` atomically; if it raises nothing is saved (usable as a compare-and-set guard)."""
        with self._lock:
            records = self._load()
            for index, record in enumerate(records):
                if record.id == offboarding_id:
                    mutator(record)
                    records[index] = record
                    self._save(records)
                    return record
            raise NotFoundError(f"Offboarding {offboarding_id} was not found.")

    def delete_where(self, predicate: Callable[[Offboarding], bool]) -> list[Offboarding]:
        with self._lock:
            records = self._load()
            removed = [r for r in records if predicate(r)]
            if removed:
                self._save([r for r in records if not predicate(r)])
            return removed

    def _load(self) -> list[Offboarding]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return [Offboarding.model_validate(item) for item in raw.get("offboardings", [])]
        except (json.JSONDecodeError, ValueError) as exc:
            backup = self._path.with_suffix(f".corrupt-{int(time.time())}.json")
            self._path.replace(backup)
            logger.error("Offboarding store was unreadable (%s); moved to %s and starting empty.", exc, backup.name)
            return []

    def _save(self, records: list[Offboarding]) -> None:
        payload = {"offboardings": [r.model_dump(mode="json", by_alias=True) for r in records]}
        fd, tmp_name = tempfile.mkstemp(dir=self._path.parent, prefix=".offboardings-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
            os.replace(tmp_name, self._path)
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

"""JSON-file persistence for pre-onboarding candidates (same approach as the reimbursement store)."""

import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.preonboarding import PreCandidate

logger = logging.getLogger(__name__)


class PreOnboardingRepository:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def list_all(self) -> list[PreCandidate]:
        with self._lock:
            return self._load()

    def get(self, record_id: str) -> PreCandidate | None:
        with self._lock:
            return next((r for r in self._load() if r.id == record_id), None)

    def require(self, record_id: str) -> PreCandidate:
        record = self.get(record_id)
        if record is None:
            raise NotFoundError(f"Candidate {record_id} was not found.")
        return record

    def add(self, record: PreCandidate) -> PreCandidate:
        """Add ``record`` at the top of the list."""
        with self._lock:
            records = self._load()
            records.insert(0, record)
            self._save(records)
            return record

    def update(self, record_id: str, mutator: Callable[[PreCandidate], None]) -> PreCandidate:
        """Apply ``mutator`` atomically; if it raises nothing is saved (usable as a compare-and-set guard)."""
        with self._lock:
            records = self._load()
            for index, record in enumerate(records):
                if record.id == record_id:
                    mutator(record)
                    records[index] = record
                    self._save(records)
                    return record
            raise NotFoundError(f"Candidate {record_id} was not found.")

    def delete_where(self, predicate: Callable[[PreCandidate], bool]) -> list[PreCandidate]:
        """Remove matching records and return them (so callers can clean up files)."""
        with self._lock:
            records = self._load()
            removed = [r for r in records if predicate(r)]
            if removed:
                self._save([r for r in records if not predicate(r)])
            return removed

    def _load(self) -> list[PreCandidate]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return [PreCandidate.model_validate(item) for item in raw.get("candidates", [])]
        except (json.JSONDecodeError, ValueError) as exc:
            backup = self._path.with_suffix(f".corrupt-{int(time.time())}.json")
            self._path.replace(backup)
            logger.error("Pre-onboarding store was unreadable (%s); moved to %s and starting empty.", exc, backup.name)
            return []

    def _save(self, records: list[PreCandidate]) -> None:
        payload = {"candidates": [r.model_dump(mode="json", by_alias=True) for r in records]}
        fd, tmp_name = tempfile.mkstemp(dir=self._path.parent, prefix=".preonboarding-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
            os.replace(tmp_name, self._path)
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

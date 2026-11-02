"""JSON-file persistence for reimbursement claims (same approach as the leave store)."""

import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.reimbursement import ReimbursementClaim

logger = logging.getLogger(__name__)


class ReimbursementRepository:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def list_all(self) -> list[ReimbursementClaim]:
        with self._lock:
            return self._load()

    def get(self, claim_id: str) -> ReimbursementClaim | None:
        with self._lock:
            return next((r for r in self._load() if r.id == claim_id), None)

    def require(self, claim_id: str) -> ReimbursementClaim:
        record = self.get(claim_id)
        if record is None:
            raise NotFoundError(f"Claim {claim_id} was not found.")
        return record

    def add(self, record: ReimbursementClaim) -> ReimbursementClaim:
        """Add ``record`` at the top of the list."""
        with self._lock:
            records = self._load()
            records.insert(0, record)
            self._save(records)
            return record

    def update(self, claim_id: str, mutator: Callable[[ReimbursementClaim], None]) -> ReimbursementClaim:
        """Apply ``mutator`` atomically; if it raises nothing is saved (usable as a compare-and-set guard)."""
        with self._lock:
            records = self._load()
            for index, record in enumerate(records):
                if record.id == claim_id:
                    mutator(record)
                    records[index] = record
                    self._save(records)
                    return record
            raise NotFoundError(f"Claim {claim_id} was not found.")

    def delete_where(self, predicate: Callable[[ReimbursementClaim], bool]) -> int:
        with self._lock:
            records = self._load()
            kept = [r for r in records if not predicate(r)]
            if len(kept) != len(records):
                self._save(kept)
            return len(records) - len(kept)

    def _load(self) -> list[ReimbursementClaim]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return [ReimbursementClaim.model_validate(item) for item in raw.get("claims", [])]
        except (json.JSONDecodeError, ValueError) as exc:
            backup = self._path.with_suffix(f".corrupt-{int(time.time())}.json")
            self._path.replace(backup)
            logger.error("Reimbursement store was unreadable (%s); moved to %s and starting empty.", exc, backup.name)
            return []

    def _save(self, records: list[ReimbursementClaim]) -> None:
        payload = {"claims": [r.model_dump(mode="json", by_alias=True) for r in records]}
        fd, tmp_name = tempfile.mkstemp(dir=self._path.parent, prefix=".claims-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
            os.replace(tmp_name, self._path)
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

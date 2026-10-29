"""JSON-file persistence for leave and attendance requests (same approach as the offboarding store)."""

import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.leave import LeaveAttendanceRequest

logger = logging.getLogger(__name__)


class LeaveRepository:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def list_all(self) -> list[LeaveAttendanceRequest]:
        with self._lock:
            return self._load()

    def get(self, request_id: str) -> LeaveAttendanceRequest | None:
        with self._lock:
            return next((r for r in self._load() if r.id == request_id), None)

    def require(self, request_id: str) -> LeaveAttendanceRequest:
        record = self.get(request_id)
        if record is None:
            raise NotFoundError(f"Request {request_id} was not found.")
        return record

    def add_if(self, record: LeaveAttendanceRequest, guard: Callable[[list[LeaveAttendanceRequest]], None]) -> LeaveAttendanceRequest:
        """Add ``record`` unless ``guard`` (given the current requests) raises. Check and insert happen under one lock."""
        with self._lock:
            records = self._load()
            guard(records)
            records.insert(0, record)
            self._save(records)
            return record

    def update(self, request_id: str, mutator: Callable[[LeaveAttendanceRequest], None]) -> LeaveAttendanceRequest:
        """Apply ``mutator`` atomically; if it raises nothing is saved (usable as a compare-and-set guard)."""
        with self._lock:
            records = self._load()
            for index, record in enumerate(records):
                if record.id == request_id:
                    mutator(record)
                    records[index] = record
                    self._save(records)
                    return record
            raise NotFoundError(f"Request {request_id} was not found.")

    def delete_where(self, predicate: Callable[[LeaveAttendanceRequest], bool]) -> int:
        with self._lock:
            records = self._load()
            kept = [r for r in records if not predicate(r)]
            if len(kept) != len(records):
                self._save(kept)
            return len(records) - len(kept)

    def _load(self) -> list[LeaveAttendanceRequest]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return [LeaveAttendanceRequest.model_validate(item) for item in raw.get("requests", [])]
        except (json.JSONDecodeError, ValueError) as exc:
            backup = self._path.with_suffix(f".corrupt-{int(time.time())}.json")
            self._path.replace(backup)
            logger.error("Leave store was unreadable (%s); moved to %s and starting empty.", exc, backup.name)
            return []

    def _save(self, records: list[LeaveAttendanceRequest]) -> None:
        payload = {"requests": [r.model_dump(mode="json", by_alias=True) for r in records]}
        fd, tmp_name = tempfile.mkstemp(dir=self._path.parent, prefix=".leave-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
            os.replace(tmp_name, self._path)
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

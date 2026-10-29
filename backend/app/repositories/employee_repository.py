"""JSON-file persistence for onboarding records.

The public surface is intentionally small so the file store can be replaced by a
real database later without touching the services.
"""

import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from app.core.exceptions import NotFoundError
from app.schemas.employee import Employee

logger = logging.getLogger(__name__)


class EmployeeRepository:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ reads
    def list_all(self) -> list[Employee]:
        with self._lock:
            return self._load()

    def get(self, employee_id: str) -> Employee | None:
        with self._lock:
            return next((e for e in self._load() if e.id == employee_id), None)

    def require(self, employee_id: str) -> Employee:
        employee = self.get(employee_id)
        if employee is None:
            raise NotFoundError(f"Candidate {employee_id} was not found.")
        return employee

    # ----------------------------------------------------------------- writes
    def add(self, employee: Employee) -> Employee:
        with self._lock:
            employees = self._load()
            employees.insert(0, employee)
            self._save(employees)
            return employee

    def update(self, employee_id: str, mutator: Callable[[Employee], None]) -> Employee:
        """Apply ``mutator`` to a record atomically.

        If ``mutator`` raises, nothing is saved - this makes it usable as a
        compare-and-set guard (e.g. "only if still Pending Review").
        """
        with self._lock:
            employees = self._load()
            for index, employee in enumerate(employees):
                if employee.id == employee_id:
                    mutator(employee)
                    employees[index] = employee
                    self._save(employees)
                    return employee
            raise NotFoundError(f"Candidate {employee_id} was not found.")

    def delete_where(self, predicate: Callable[[Employee], bool]) -> list[Employee]:
        """Remove matching records and return them (so callers can clean up files)."""
        with self._lock:
            employees = self._load()
            removed = [e for e in employees if predicate(e)]
            if removed:
                self._save([e for e in employees if not predicate(e)])
            return removed

    # --------------------------------------------------------------- internals
    def _load(self) -> list[Employee]:
        if not self._path.exists():
            return []
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return [Employee.model_validate(item) for item in raw.get("employees", [])]
        except (json.JSONDecodeError, ValueError) as exc:
            backup = self._path.with_suffix(f".corrupt-{int(time.time())}.json")
            self._path.replace(backup)
            logger.error("Employee store was unreadable (%s); moved to %s and starting empty.", exc, backup.name)
            return []

    def _save(self, employees: list[Employee]) -> None:
        payload = {"employees": [e.model_dump(mode="json", by_alias=True) for e in employees]}
        fd, tmp_name = tempfile.mkstemp(dir=self._path.parent, prefix=".employees-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
            os.replace(tmp_name, self._path)
        except Exception:
            Path(tmp_name).unlink(missing_ok=True)
            raise

"""PostgreSQL storage for the four record lists (onboarding, offboarding, leave, reimbursement).

Same public surface as the JSON-file repositories, so the services do not change. Every record is one row holding the record
as JSON, in one shared table; ``seq`` keeps the newest-first order the portal shows. The first time a list is used, the old
``.json`` file is copied in once and then left untouched as a backup.
"""

import json
import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import ClassVar, Generic, TypeVar

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.repositories.database import Database
from app.schemas.employee import Employee
from app.schemas.leave import LeaveAttendanceRequest
from app.schemas.offboarding import Offboarding
from app.schemas.preonboarding import PreCandidate
from app.schemas.reimbursement import ReimbursementClaim

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_CREATE = """
CREATE TABLE IF NOT EXISTS portal_records (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    seq        BIGSERIAL,
    data       JSONB NOT NULL,
    PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS portal_records_order ON portal_records (collection, seq DESC);
CREATE TABLE IF NOT EXISTS portal_migrations (
    name        TEXT PRIMARY KEY,
    imported    INTEGER NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


class PgCollection(Generic[T]):
    collection: ClassVar[str]
    root_key: ClassVar[str]  # the list's key in the old JSON file
    not_found: ClassVar[str]  # message with {id}
    model: type[T]

    def __init__(self, db: Database, legacy_file: Path | None = None):
        self._db = db
        self._legacy_file = legacy_file
        self._lock = threading.RLock()
        self._ready = False

    # --------------------------------------------------------------- set-up
    def prepare(self) -> None:
        """Create the tables and import the old JSON file once. Safe to call again; retried until it works."""
        with self._lock:
            if self._ready:
                return
            self._db.ensure_schema_exists()
            with self._db.connect() as conn:
                conn.execute("SELECT pg_advisory_xact_lock(hashtext('portal_records_setup'))")
                conn.execute(_CREATE)
                self._import_legacy(conn)
            self._ready = True

    def _import_legacy(self, conn) -> None:
        path = self._legacy_file
        if path is None or not path.exists():
            return
        done = conn.execute("SELECT 1 FROM portal_migrations WHERE name = %s", (self.collection,)).fetchone()
        if done:
            return
        try:
            items = json.loads(path.read_text(encoding="utf-8")).get(self.root_key, [])
        except (json.JSONDecodeError, OSError, AttributeError) as exc:
            logger.error("%s was not imported into the database (%s); it is left as it is.", path.name, exc)
            return
        imported = 0
        for item in reversed(items):  # the file lists newest first, so the oldest goes in first and gets the lowest seq
            try:
                record = self.model.model_validate(item)
            except ValueError as exc:
                logger.warning("A record in %s was skipped while importing: %s", path.name, exc)
                continue
            conn.execute(
                "INSERT INTO portal_records (collection, id, data) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (self.collection, record.id, Jsonb(record.model_dump(mode="json", by_alias=True))),
            )
            imported += 1
        conn.execute("INSERT INTO portal_migrations (name, imported) VALUES (%s, %s)", (self.collection, imported))
        logger.info("Imported %d record(s) from %s into the database (the file was not changed).", imported, path.name)

    @contextmanager
    def _begin(self) -> Iterator:
        """A connection with the list locked for writing (other writers, in this or another process, wait). Commits on success."""
        self.prepare()
        with self._db.connect() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (self.collection,))
            yield conn

    def _load_all(self, conn) -> list[T]:
        rows = conn.execute("SELECT data FROM portal_records WHERE collection = %s ORDER BY seq DESC", (self.collection,)).fetchall()
        return [self.model.model_validate(row["data"]) for row in rows]

    def _dump(self, record: T) -> Jsonb:
        return Jsonb(record.model_dump(mode="json", by_alias=True))

    # ------------------------------------------------------------------ reads
    def list_all(self) -> list[T]:
        self.prepare()
        with self._db.connect() as conn:
            return self._load_all(conn)

    def get(self, record_id: str) -> T | None:
        self.prepare()
        with self._db.connect() as conn:
            row = conn.execute("SELECT data FROM portal_records WHERE collection = %s AND id = %s", (self.collection, record_id)).fetchone()
        return self.model.model_validate(row["data"]) if row else None

    def require(self, record_id: str) -> T:
        record = self.get(record_id)
        if record is None:
            raise NotFoundError(self.not_found.format(id=record_id))
        return record

    # ----------------------------------------------------------------- writes
    def _insert(self, conn, record: T) -> None:
        conn.execute(
            "INSERT INTO portal_records (collection, id, data) VALUES (%s, %s, %s) "
            "ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data",
            (self.collection, record.id, self._dump(record)),
        )

    def add(self, record: T) -> T:
        """Add ``record`` at the top of the list."""
        with self._begin() as conn:
            self._insert(conn, record)
        return record

    def add_if(self, record: T, guard: Callable[[list[T]], None]) -> T:
        """Add ``record`` unless ``guard`` (given the current records) raises. Check and insert happen under one lock."""
        with self._begin() as conn:
            guard(self._load_all(conn))
            self._insert(conn, record)
        return record

    def update(self, record_id: str, mutator: Callable[[T], None]) -> T:
        """Apply ``mutator`` to a record atomically; if it raises nothing is saved (usable as a compare-and-set guard)."""
        with self._begin() as conn:
            row = conn.execute(
                "SELECT data FROM portal_records WHERE collection = %s AND id = %s", (self.collection, record_id)
            ).fetchone()
            if row is None:
                raise NotFoundError(self.not_found.format(id=record_id))
            record = self.model.model_validate(row["data"])
            mutator(record)
            conn.execute(
                "UPDATE portal_records SET data = %s WHERE collection = %s AND id = %s", (self._dump(record), self.collection, record_id)
            )
        return record

    def _remove(self, predicate: Callable[[T], bool]) -> list[T]:
        with self._begin() as conn:
            removed = [r for r in self._load_all(conn) if predicate(r)]
            if removed:
                conn.execute(
                    "DELETE FROM portal_records WHERE collection = %s AND id = ANY(%s)", (self.collection, [r.id for r in removed])
                )
        return removed


class PgEmployeeRepository(PgCollection[Employee]):
    collection, root_key, not_found, model = "employees", "employees", "Candidate {id} was not found.", Employee

    def delete_where(self, predicate: Callable[[Employee], bool]) -> list[Employee]:
        """Remove matching records and return them (so callers can clean up files)."""
        return self._remove(predicate)


class PgOffboardingRepository(PgCollection[Offboarding]):
    collection, root_key, not_found, model = "offboardings", "offboardings", "Offboarding {id} was not found.", Offboarding

    def delete_where(self, predicate: Callable[[Offboarding], bool]) -> list[Offboarding]:
        return self._remove(predicate)


class PgLeaveRepository(PgCollection[LeaveAttendanceRequest]):
    collection, root_key, not_found, model = "leave_requests", "requests", "Request {id} was not found.", LeaveAttendanceRequest

    def delete_where(self, predicate: Callable[[LeaveAttendanceRequest], bool]) -> int:
        return len(self._remove(predicate))


class PgReimbursementRepository(PgCollection[ReimbursementClaim]):
    collection, root_key, not_found, model = "reimbursement_claims", "claims", "Claim {id} was not found.", ReimbursementClaim

    def delete_where(self, predicate: Callable[[ReimbursementClaim], bool]) -> int:
        return len(self._remove(predicate))


class PgPreOnboardingRepository(PgCollection[PreCandidate]):
    collection, root_key, not_found, model = "preonboarding", "candidates", "Candidate {id} was not found.", PreCandidate

    def delete_where(self, predicate: Callable[[PreCandidate], bool]) -> list[PreCandidate]:
        return self._remove(predicate)

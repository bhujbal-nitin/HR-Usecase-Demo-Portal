"""Requests for portal access made from the login page, waiting for an admin to approve or reject them."""

from typing import Protocol

from app.repositories.database import Database

TABLE = "access_requests"
STATUSES = ("pending", "approved", "rejected")

_CREATE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id           SERIAL PRIMARY KEY,
    email        TEXT NOT NULL,
    full_name    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at   TIMESTAMPTZ,
    decided_by   TEXT,
    username     TEXT,
    phone        TEXT NOT NULL DEFAULT '',
    country      TEXT NOT NULL DEFAULT ''
);
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS {TABLE}_status ON {TABLE} (status, requested_at DESC);
"""

_COLUMNS = "id, email, full_name, status, requested_at, decided_at, decided_by, username, phone, country"


class AccessRequestRepository(Protocol):
    def ensure_schema(self) -> None: ...
    def add(self, email: str, full_name: str, phone: str = "", country: str = "") -> dict: ...
    def get(self, request_id: int) -> dict | None: ...
    def pending_for(self, email: str) -> dict | None: ...
    def list_all(self) -> list[dict]: ...
    def decide(self, request_id: int, status: str, decided_by: str, username: str | None) -> bool: ...


class PostgresAccessRequestRepository:
    def __init__(self, db: Database):
        self._db = db

    def ensure_schema(self) -> None:
        self._db.ensure_schema_exists()
        with self._db.connect() as conn:
            conn.execute(_CREATE)

    def add(self, email: str, full_name: str, phone: str = "", country: str = "") -> dict:
        with self._db.connect() as conn:
            return conn.execute(
                f"INSERT INTO {TABLE} (email, full_name, phone, country) VALUES (%s, %s, %s, %s) RETURNING {_COLUMNS}", (email, full_name, phone, country)
            ).fetchone()

    def get(self, request_id: int) -> dict | None:
        with self._db.connect() as conn:
            return conn.execute(f"SELECT {_COLUMNS} FROM {TABLE} WHERE id = %s", (request_id,)).fetchone()

    def pending_for(self, email: str) -> dict | None:
        with self._db.connect() as conn:
            return conn.execute(f"SELECT {_COLUMNS} FROM {TABLE} WHERE lower(email) = lower(%s) AND status = 'pending'", (email,)).fetchone()

    def list_all(self) -> list[dict]:
        with self._db.connect() as conn:
            return conn.execute(f"SELECT {_COLUMNS} FROM {TABLE} ORDER BY (status = 'pending') DESC, requested_at DESC, id DESC LIMIT 500").fetchall()

    def decide(self, request_id: int, status: str, decided_by: str, username: str | None) -> bool:
        """Close a pending request, once. False when it was already decided."""
        with self._db.connect() as conn:
            done = conn.execute(
                f"UPDATE {TABLE} SET status = %s, decided_at = now(), decided_by = %s, username = %s WHERE id = %s AND status = 'pending'",
                (status, decided_by, username, request_id),
            ).rowcount
        return done > 0

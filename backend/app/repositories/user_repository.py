"""The portal's login users, kept in PostgreSQL (the table is created on first start; admins add users in the portal)."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from app.repositories.database import Database

TABLE = "portal_users"
ROLES = ("admin", "user")
ACCESS_TYPES = ("days", "date", "lifetime")

_CREATE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL DEFAULT '',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS access_type TEXT NOT NULL DEFAULT 'lifetime';
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS access_days INTEGER NULL;
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ NULL;
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;
ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS {TABLE}_username_lower ON {TABLE} (lower(username));
-- A portal that has users but no admin yet (it was set up before roles existed): the first user becomes the admin.
UPDATE {TABLE} SET role = 'admin'
 WHERE id = (SELECT min(id) FROM {TABLE}) AND NOT EXISTS (SELECT 1 FROM {TABLE} WHERE role = 'admin');
"""


@dataclass
class PortalUser:
    username: str
    password_hash: str
    full_name: str = ""
    is_active: bool = True
    role: str = "user"
    created_at: datetime | None = field(default=None, compare=False)
    access_type: str = "lifetime"  # "days", "date", "lifetime"
    access_days: int | None = None
    first_login_at: datetime | None = None
    expires_at: datetime | None = None
    must_change_password: bool = False  # the password was e-mailed: it has to be changed at the first sign-in

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        now = datetime.now(timezone.utc)
        exp = self.expires_at if self.expires_at.tzinfo else self.expires_at.replace(tzinfo=timezone.utc)
        return now > exp


class UserRepository(Protocol):
    def ensure_schema(self) -> None: ...
    def get(self, username: str) -> PortalUser | None: ...
    def save(self, user: PortalUser) -> None: ...
    def list_all(self) -> list[PortalUser]: ...
    def delete(self, username: str) -> None: ...


_COLUMNS = "username, password_hash, full_name, is_active, role, created_at, access_type, access_days, first_login_at, expires_at, must_change_password"


class PostgresUserRepository:
    def __init__(self, db: Database):
        self._db = db

    def ensure_schema(self) -> None:
        self._db.ensure_schema_exists()
        with self._db.connect() as conn:
            conn.execute(_CREATE)

    def get(self, username: str) -> PortalUser | None:
        with self._db.connect() as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM {TABLE} WHERE lower(username) = lower(%s)", (username,)).fetchone()
        return PortalUser(**row) if row else None

    def list_all(self) -> list[PortalUser]:
        with self._db.connect() as conn:
            rows = conn.execute(f"SELECT {_COLUMNS} FROM {TABLE} ORDER BY id").fetchall()
        return [PortalUser(**row) for row in rows]

    def delete(self, username: str) -> None:
        with self._db.connect() as conn:
            conn.execute(f"DELETE FROM {TABLE} WHERE lower(username) = lower(%s)", (username,))

    def save(self, user: PortalUser) -> None:
        """Add the user, or change the password / name / role / active flag / access of the one with that user name."""
        with self._db.connect() as conn:
            conn.execute(
                f"""INSERT INTO {TABLE} (username, password_hash, full_name, is_active, role, access_type, access_days, first_login_at, expires_at, must_change_password)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (lower(username)) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name,
                        is_active = EXCLUDED.is_active, role = EXCLUDED.role,
                        access_type = EXCLUDED.access_type, access_days = EXCLUDED.access_days,
                        first_login_at = EXCLUDED.first_login_at, expires_at = EXCLUDED.expires_at,
                        must_change_password = EXCLUDED.must_change_password""",
                (
                    user.username,
                    user.password_hash,
                    user.full_name,
                    user.is_active,
                    user.role,
                    user.access_type,
                    user.access_days,
                    user.first_login_at,
                    user.expires_at,
                    user.must_change_password,
                ),
            )


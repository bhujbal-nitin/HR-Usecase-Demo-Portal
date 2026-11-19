"""Demo runs: one row each time a signed-in user starts a demo, so an admin can see who ran which demo, in which mode, when, and how it ended."""

import logging
from typing import Protocol

from app.repositories.database import Database

logger = logging.getLogger(__name__)
TABLE = "demo_runs"

_CREATE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id         BIGSERIAL PRIMARY KEY,
    username   TEXT NOT NULL,
    agent      TEXT NOT NULL,
    mode       TEXT NOT NULL,
    manual     BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ,
    outcome    TEXT,
    detail     TEXT
);
CREATE INDEX IF NOT EXISTS {TABLE}_user_time ON {TABLE} (lower(username), started_at DESC);
"""


class DemoRunRepository(Protocol):
    def ensure_schema(self) -> None: ...
    def start(self, username: str, agent: str, mode: str, manual: bool) -> int | None: ...
    def finish(self, run_id: int, username: str, outcome: str, detail: str) -> bool: ...
    def history(self, username: str | None, agent: str | None, limit: int, offset: int) -> tuple[list[dict], int]: ...


class NoDemoRunRepository:
    """Used when there is no database (storage 'json' and no login): nothing is recorded."""

    def ensure_schema(self) -> None: ...
    def start(self, username: str, agent: str, mode: str, manual: bool) -> int | None:
        return None

    def finish(self, run_id: int, username: str, outcome: str, detail: str) -> bool:
        return False

    def history(self, username: str | None, agent: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
        return [], 0


class PostgresDemoRunRepository:
    def __init__(self, db: Database):
        self._db = db

    def ensure_schema(self) -> None:
        self._db.ensure_schema_exists()
        with self._db.connect() as conn:
            conn.execute(_CREATE)

    def start(self, username: str, agent: str, mode: str, manual: bool) -> int | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"INSERT INTO {TABLE} (username, agent, mode, manual) VALUES (%s, %s, %s, %s) RETURNING id", (username, agent, mode, manual)
            ).fetchone()
        return row["id"]

    def finish(self, run_id: int, username: str, outcome: str, detail: str) -> bool:
        """Close the user's own run, once. False when there is no such open run."""
        with self._db.connect() as conn:
            done = conn.execute(
                f"UPDATE {TABLE} SET ended_at = now(), outcome = %s, detail = %s WHERE id = %s AND lower(username) = lower(%s) AND ended_at IS NULL",
                (outcome, detail or None, run_id, username),
            ).rowcount
        return done > 0

    def history(self, username: str | None, agent: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
        clauses, params = [], []
        if username:
            clauses.append("lower(username) = lower(%s)")
            params.append(username)
        if agent:
            clauses.append("agent = %s")
            params.append(agent)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._db.connect() as conn:
            total = conn.execute(f"SELECT count(*) AS n FROM {TABLE} {where}", params).fetchone()["n"]
            rows = conn.execute(
                f"""SELECT id, username, agent, mode, manual, started_at, ended_at, outcome, detail
                    FROM {TABLE} {where} ORDER BY started_at DESC, id DESC LIMIT %s OFFSET %s""",
                (*params, limit, offset),
            ).fetchall()
        return rows, total

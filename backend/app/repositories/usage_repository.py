"""Token usage of the AI calls, one row per call, so an admin can see who used how much and when."""

import logging
from dataclasses import dataclass
from typing import Protocol

from app.repositories.database import Database

logger = logging.getLogger(__name__)
TABLE = "ai_usage"

_CREATE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    feature       TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS {TABLE}_user_time ON {TABLE} (lower(username), created_at DESC);
"""


@dataclass
class UsageCall:
    username: str
    feature: str
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int


class UsageRepository(Protocol):
    def ensure_schema(self) -> None: ...
    def record(self, call: UsageCall) -> None: ...
    def totals(self, days: int | None = None) -> list[dict]: ...
    def history(self, username: str | None, limit: int, offset: int) -> tuple[list[dict], int]: ...


class NoUsageRepository:
    """Used when there is no database (storage 'json' and no login): nothing is recorded."""

    def ensure_schema(self) -> None: ...
    def record(self, call: UsageCall) -> None: ...
    def totals(self, days: int | None = None) -> list[dict]:
        return []

    def history(self, username: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
        return [], 0


class PostgresUsageRepository:
    def __init__(self, db: Database):
        self._db = db

    def ensure_schema(self) -> None:
        self._db.ensure_schema_exists()
        with self._db.connect() as conn:
            conn.execute(_CREATE)

    def record(self, call: UsageCall) -> None:
        with self._db.connect() as conn:
            conn.execute(
                f"INSERT INTO {TABLE} (username, feature, model, input_tokens, output_tokens, total_tokens) VALUES (%s, %s, %s, %s, %s, %s)",
                (call.username, call.feature, call.model, call.input_tokens, call.output_tokens, call.total_tokens),
            )

    def totals(self, days: int | None = None) -> list[dict]:
        """One row per user name (case-insensitive): calls and tokens, optionally only the last ``days`` days."""
        where, params = ("WHERE created_at >= now() - make_interval(days => %s)", (days,)) if days else ("", ())
        with self._db.connect() as conn:
            return conn.execute(
                f"""SELECT min(username) AS username, count(*) AS calls, sum(input_tokens)::bigint AS input_tokens,
                           sum(output_tokens)::bigint AS output_tokens, sum(total_tokens)::bigint AS total_tokens,
                           max(created_at) AS last_used
                    FROM {TABLE} {where} GROUP BY lower(username) ORDER BY sum(total_tokens) DESC""",
                params,
            ).fetchall()

    def history(self, username: str | None, limit: int, offset: int) -> tuple[list[dict], int]:
        where, params = ("WHERE lower(username) = lower(%s)", (username,)) if username else ("", ())
        with self._db.connect() as conn:
            total = conn.execute(f"SELECT count(*) AS n FROM {TABLE} {where}", params).fetchone()["n"]
            rows = conn.execute(
                f"""SELECT id, username, feature, model, input_tokens, output_tokens, total_tokens, created_at
                    FROM {TABLE} {where} ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (*params, limit, offset),
            ).fetchall()
        return rows, total

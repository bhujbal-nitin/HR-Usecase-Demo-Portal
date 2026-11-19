"""One place that knows how to open a connection to the portal's PostgreSQL database."""

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.core.config import Settings
from app.core.exceptions import IntegrationError

SYSTEM = "PostgreSQL"


class Database:
    def __init__(self, settings: Settings):
        self._s = settings

    def is_configured(self) -> bool:
        return bool(self._s.pg_database and self._s.pg_user)

    def check_connection(self) -> str:
        with self.connect() as conn:
            conn.execute(sql.SQL("SELECT 1"))
        return "Connected"

    def connect(self) -> psycopg.Connection:
        """A new connection (use it in a ``with`` block: it commits on success, rolls back on an error and closes)."""
        if not self.is_configured():
            raise IntegrationError(SYSTEM, "not configured (set PG_DATABASE and PG_USER in .env)")
        schema = self._s.pg_schema.strip()
        try:
            return psycopg.connect(
                host=self._s.pg_host, port=self._s.pg_port, dbname=self._s.pg_database, user=self._s.pg_user,
                password=self._s.pg_password.get_secret_value(), connect_timeout=5, row_factory=dict_row,
                options=f"-c search_path={schema}" if schema else None,
            )
        except psycopg.Error as exc:
            raise IntegrationError(SYSTEM, f"cannot connect to {self._s.pg_host}:{self._s.pg_port}/{self._s.pg_database}: {exc}") from exc

    def ensure_schema_exists(self) -> None:
        """Create the PG_SCHEMA schema when one is configured (the default schema always exists)."""
        schema = self._s.pg_schema.strip()
        if not schema:
            return
        with psycopg.connect(
            host=self._s.pg_host, port=self._s.pg_port, dbname=self._s.pg_database, user=self._s.pg_user,
            password=self._s.pg_password.get_secret_value(), connect_timeout=5,
        ) as conn:
            conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))

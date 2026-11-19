"""Persistence for the HRMS replica: the whole data set is one JSON document (a file, or one row of ``portal_records``).

``read()`` / ``write()`` give the document under a lock; ``write()`` saves it when the block ends without an error and
throws the changes away otherwise.
"""

import json
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from pydantic import BaseModel

from app.repositories.pg_store import PgCollection

_DOC_ID = "state"


class HrmsDoc(BaseModel):
    id: str = _DOC_ID
    data: dict = {}


class PgHrmsCollection(PgCollection[HrmsDoc]):
    collection, root_key, not_found, model = "hrms", "hrms", "HRMS data {id} was not found.", HrmsDoc


class HrmsStore:
    """JSON-file store (``path``) or PostgreSQL store (``collection``)."""

    def __init__(self, path: Path | None = None, collection: PgHrmsCollection | None = None):
        self._path, self._pg = path, collection
        self._lock = threading.RLock()
        self._cache: dict | None = None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)

    # ----------------------------------------------------------------- raw
    def _load(self) -> dict:
        if self._pg is not None:
            doc = self._pg.get(_DOC_ID)
            return doc.data if doc else {}
        if self._cache is None:
            try:
                self._cache = json.loads(self._path.read_text(encoding="utf-8")) if self._path.exists() else {}
            except (OSError, ValueError):
                self._cache = {}
        return self._cache

    def _save(self, state: dict) -> None:
        if self._pg is not None:
            self._pg.add(HrmsDoc(data=state))
            return
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".hrms-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, ensure_ascii=False)
            os.replace(tmp, self._path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise

    # ------------------------------------------------------------- public
    @contextmanager
    def read(self):
        """The data, for reading only."""
        with self._lock:
            yield self._load()

    @contextmanager
    def write(self):
        """The data, for changing; saved when the block ends normally."""
        with self._lock:
            state = self._load()
            try:
                yield state
                self._save(state)
            except BaseException:
                self._cache = None  # drop the half-changed copy; the next use reads what was saved
                raise

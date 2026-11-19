"""The HRMS replica as one object the container holds: its store, its login, and first-start seeding."""

import logging
from collections.abc import Callable
from datetime import date

from app.core.config import Settings
from app.hrms import seed
from app.hrms.auth import HrmsAuth
from app.hrms.store import HrmsStore
from app.schemas.employee import Employee

logger = logging.getLogger(__name__)


class HrmsService:
    def __init__(self, settings: Settings, store: HrmsStore, employees: Callable[[], list[Employee]]):
        self.store = store
        self.auth = HrmsAuth(settings)
        self._employees = employees
        self._ready = False

    def ensure_seeded(self) -> bool:
        """Fill the data set from the portal's employees on first use (a no-op once seeded). True if it seeded now."""
        if self._ready:
            return False
        with self.store.write() as state:
            if seed.is_seeded(state):
                self._ready = True
                return False
            people = self._employees()
            seed.seed(state, people, date.today())
        self._ready = True
        logger.info("HRMS seeded from %d portal employee record(s).", len(people))
        return True

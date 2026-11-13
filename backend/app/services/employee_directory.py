"""Finding an onboarded employee and their OrangeHRM number (shared by the demos that work on one employee's records)."""

import logging
import threading

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.integrations.orangehrm import OrangeHRMClient, ProfileNotFound
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.offboarding_repository import OffboardingRepository
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.schemas.offboarding import EmployeeSummary, OffboardingStatus

logger = logging.getLogger(__name__)


def work_email(e: Employee) -> str:
    return (e.orange_hrm.work_email if e.orange_hrm and e.orange_hrm.work_email else None) or e.email


def require_still_employed(offboardings: OffboardingRepository | None, employee: Employee, purpose: str) -> None:
    """Stop work for an employee whose offboarding is complete: OrangeHRM has terminated them, so it refuses new records (``purpose`` words the message)."""
    if offboardings and any(o.employee_id == employee.id and o.status == OffboardingStatus.COMPLETED for o in offboardings.list_all()):
        raise ConflictError(f"{employee.full_name} has left the company (offboarding is complete), so there are no {purpose} to work on.")


_profile_lock = threading.Lock()  # two requests for the same employee must not each create a profile


def resolve_emp_number(employees: EmployeeRepository, orangehrm: OrangeHRMClient, employee: Employee) -> int:
    """The employee's number in the OrangeHRM that is running now.

    The number saved at onboarding is used while OrangeHRM still has that profile. If OrangeHRM was rebuilt or reset, the person is
    looked up by name, and a profile is created from the saved onboarding details when there is none; the new number is saved.
    """
    stored = employee.orange_hrm.emp_number if employee.orange_hrm else None
    if stored and orangehrm.employee_exists(stored):
        return stored
    with _profile_lock:
        try:
            number = orangehrm.find_employee_number(employee.full_name)
        except ProfileNotFound:
            result = orangehrm.create_employee_profile(employee, work_email(employee), [])
            number, info = result.info.emp_number, result.info
            logger.info("OrangeHRM had no profile for %s (saved number %s); created #%s", employee.id, stored, number)
            if result.warnings:
                logger.warning("OrangeHRM profile for %s created with gaps: %s", employee.id, "; ".join(result.warnings))
        else:
            info = (employee.orange_hrm or OrangeHrmInfo()).model_copy(update={"emp_number": number})
            logger.info("OrangeHRM profile for %s is now #%s (saved number %s)", employee.id, number, stored)
        employees.update(employee.id, lambda e: setattr(e, "orange_hrm", info))
        return number


class EmployeeDirectory:
    def __init__(self, employees: EmployeeRepository, orangehrm: OrangeHRMClient, offboardings: OffboardingRepository | None = None):
        self._employees = employees
        self._orangehrm = orangehrm
        self._offboardings = offboardings

    def require_still_employed(self, employee: Employee, purpose: str) -> None:
        require_still_employed(self._offboardings, employee, purpose)

    def find(self, ref: str, purpose: str) -> Employee:
        """An approved employee, found by Employee ID or by personal / work e-mail (``purpose`` words the not-onboarded message)."""
        wanted = ref.strip().lower()
        if not wanted:
            raise ValidationFailedError("Enter your employee ID or e-mail address.")
        for e in self._employees.list_all():
            if wanted in {e.id.lower(), e.email.lower(), work_email(e).lower()}:
                if e.status != EmployeeStatus.APPROVED:
                    raise ConflictError(f"{e.full_name} has not completed onboarding yet, so there are no {purpose}.")
                return e
        raise NotFoundError("No employee onboarded through this portal matches that ID or e-mail address.")

    def emp_number(self, employee: Employee) -> int:
        """The employee's OrangeHRM number (see ``resolve_emp_number``)."""
        return resolve_emp_number(self._employees, self._orangehrm, employee)

    @staticmethod
    def summary(e: Employee) -> EmployeeSummary:
        return EmployeeSummary(employee_id=e.id, full_name=e.full_name, department=e.department, job_title=e.job_title, manager=e.manager, work_email=work_email(e))

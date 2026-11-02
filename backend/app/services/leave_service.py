"""Use-cases for leave and attendance.

OrangeHRM is the source of the balances, holidays, work week and punch records, and is where approved leave and punch corrections are
recorded. The demo works with three standard leave types (policy.STANDARD_LEAVE_TYPES): any that OrangeHRM lacks is created, and an
employee with no quota for one is given the default. Nothing else is involved. The portal keeps only the approval record
(pending, approved or rejected) so a manager can decide on the Approvals page.
"""

import logging
import secrets
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.core.config import Settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.integrations.orangehrm import OrangeHRMClient
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.leave_repository import LeaveRepository
from app.repositories.offboarding_repository import OffboardingRepository
from app.schemas.employee import Employee, EmployeeStatus
from app.schemas.leave import (
    AttendanceDayRecords,
    Holiday,
    LeaveApplication,
    LeaveAttendanceRequest,
    LeaveBalance,
    LeaveCheck,
    LeaveCheckRequest,
    LeaveOptions,
    PunchRecord,
    RegularizationApplication,
    RequestKind,
    RequestStatus,
)
from app.schemas.offboarding import EmployeeSummary
from app.services.employee_directory import require_still_employed
from app.services.leave import policy

logger = logging.getLogger(__name__)

_FINAL = {RequestStatus.APPROVED, RequestStatus.REJECTED}
_COUNTED = {RequestStatus.PENDING, RequestStatus.APPROVED}  # requests that hold leave days or cover a punch
_DEMO_NOTE = "HR Demo Portal"


@dataclass
class LeaveGateways:
    settings: Settings
    orangehrm: OrangeHRMClient


def _work_email(e: Employee) -> str:
    return (e.orange_hrm.work_email if e.orange_hrm and e.orange_hrm.work_email else None) or e.email


def _holds_days(r: LeaveAttendanceRequest) -> bool:
    """Leave that is not in OrangeHRM yet but still has to come off the balance: waiting for approval, or approved and not yet recorded."""
    return r.status == RequestStatus.PENDING or (r.status == RequestStatus.APPROVED and not r.applied)


class LeaveService:
    def __init__(self, repository: LeaveRepository, employees: EmployeeRepository, gateways: LeaveGateways, offboardings: OffboardingRepository | None = None):
        self._repo = repository
        self._employees = employees
        self._gw = gateways
        self._offboardings = offboardings
        self._apply_lock = threading.Lock()  # recording a request in OrangeHRM must never happen twice

    # ------------------------------------------------------------------ employee
    def _find_employee(self, ref: str) -> Employee:
        """An onboarded (approved) employee, found by Employee ID or by personal / work e-mail."""
        wanted = ref.strip().lower()
        if not wanted:
            raise ValidationFailedError("Enter your employee ID or e-mail address.")
        for e in self._employees.list_all():
            if wanted in {e.id.lower(), e.email.lower(), _work_email(e).lower()}:
                if e.status != EmployeeStatus.APPROVED:
                    raise ConflictError(f"{e.full_name} has not completed onboarding yet, so there are no leave or attendance records.")
                require_still_employed(self._offboardings, e, "leave or attendance records")
                return e
        raise NotFoundError("No employee onboarded through this portal matches that ID or e-mail address.")

    def _emp_number(self, employee: Employee) -> int:
        """The employee's OrangeHRM number: recorded at onboarding, else looked up by name."""
        if employee.orange_hrm and employee.orange_hrm.emp_number:
            return employee.orange_hrm.emp_number
        return self._gw.orangehrm.find_employee_number(employee.full_name)

    def lookup(self, ref: str) -> EmployeeSummary:
        e = self._find_employee(ref)
        return EmployeeSummary(
            employee_id=e.id, full_name=e.full_name, department=e.department, job_title=e.job_title, manager=e.manager, work_email=_work_email(e)
        )

    # --------------------------------------------------------------- OrangeHRM reads
    def _leave_types(self) -> dict[str, int]:
        """The standard leave types and their OrangeHRM ids; a type OrangeHRM does not have yet is created."""
        oh = self._gw.orangehrm
        known = {t["name"]: t["id"] for t in oh.leave_types()}
        for name in policy.STANDARD_LEAVE_TYPES:
            if name not in known:
                known[name] = oh.create_leave_type(name)
                logger.info("Created the leave type '%s' in OrangeHRM", name)
        return {name: known[name] for name in policy.STANDARD_LEAVE_TYPES}

    def _balance_rows(self, emp_number: int, types: dict[str, int], names: list[str]) -> list[dict]:
        """OrangeHRM's balances; an employee with no quota for one of ``names`` is first given the default quota for it."""
        oh = self._gw.orangehrm
        rows = oh.leave_balances(emp_number)
        have = {r["leaveTypeId"] for r in rows}
        missing = [name for name in names if types[name] not in have]
        if missing:
            start, end = oh.leave_period(date.today())
            for name in missing:
                oh.add_entitlement(emp_number, types[name], policy.STANDARD_LEAVE_TYPES[name], start, end)
                logger.info("Gave employee %s a default %s quota in OrangeHRM", emp_number, name)
            rows = oh.leave_balances(emp_number)
        return rows

    def _calendar(self, start: date, end: date) -> tuple[dict[str, int], dict[date, str]]:
        """The company's work week and its full-day holidays in the period, from OrangeHRM."""
        oh = self._gw.orangehrm
        return oh.work_week() or policy.DEFAULT_WORK_WEEK, policy.full_day_holidays(oh.holidays(start, end))

    def options(self) -> LeaveOptions:
        return LeaveOptions(leave_types=list(self._leave_types()), shift_end=policy.SHIFT_END)

    def holidays(self) -> list[Holiday]:
        today = date.today()
        return policy.upcoming_holidays(self._gw.orangehrm.holidays(today, today + timedelta(days=366)), today)

    def balances(self, ref: str) -> list[LeaveBalance]:
        employee = self._find_employee(ref)
        records = self._repo.list_all()
        types = self._leave_types()
        result = []
        for row in self._balance_rows(self._emp_number(employee), types, list(types)):
            if row["leaveType"] not in types:
                continue  # only the standard leave types are part of this demo
            held = self._held(records, employee.id, row["leaveType"])
            result.append(LeaveBalance(leave_type=row["leaveType"], total=row["entitled"], used=row["used"], pending=held, left=row["balance"] - held))
        return result

    def list_requests(self) -> list[LeaveAttendanceRequest]:
        return self._repo.list_all()

    def get_request(self, request_id: str) -> LeaveAttendanceRequest:
        return self._repo.require(request_id)

    # --------------------------------------------------------------------- leave
    @staticmethod
    def _held(records: list[LeaveAttendanceRequest], employee_id: str, leave_type: str) -> int:
        return sum(r.days or 0 for r in records if r.employee_id == employee_id and r.kind == RequestKind.LEAVE and r.leave_type == leave_type and _holds_days(r))

    @staticmethod
    def _own_overlap(records: list[LeaveAttendanceRequest], employee_id: str, start: date, end: date) -> LeaveAttendanceRequest | None:
        return next((
            r for r in records
            if r.employee_id == employee_id and r.kind == RequestKind.LEAVE and _holds_days(r) and r.start_date and r.end_date
            and r.start_date <= end and start <= r.end_date
        ), None)

    def check_leave(self, data: LeaveCheckRequest) -> LeaveCheck:
        employee = self._find_employee(data.employee_ref)
        return self._check(employee, self._emp_number(employee), data, self._repo.list_all(), date.today())[0]

    def _check(self, employee: Employee, emp_number: int, data: LeaveCheckRequest, records: list[LeaveAttendanceRequest], today: date) -> tuple[LeaveCheck, float]:
        """The balance and policy checks against OrangeHRM. Returns the check and OrangeHRM's own balance for the leave type."""
        oh = self._gw.orangehrm
        types = self._leave_types()
        if data.leave_type not in types:
            raise ValidationFailedError(f"Unknown leave type. Choose one of: {', '.join(types) or 'none are set up in OrangeHRM'}.")
        work_week, holidays = self._calendar(data.start_date, data.end_date)
        days = policy.working_days(data.start_date, data.end_date, work_week, holidays)
        row = next((b for b in self._balance_rows(emp_number, types, [data.leave_type]) if b["leaveTypeId"] == types[data.leave_type]), None)
        raw_balance = row["balance"] if row else 0.0
        left = raw_balance - self._held(records, employee.id, data.leave_type)

        problems: list[str] = []
        if data.start_date < today:
            problems.append("The leave cannot start in the past.")
        if days == 0:
            problems.append("These dates are all weekends or holidays, so no leave is needed.")
        if row is None:
            problems.append(f"You have no {data.leave_type} entitlement in OrangeHRM.")
        elif days > left:
            problems.append(f"Only {left:g} day(s) of {data.leave_type} are left, but {days} were asked for.")
        own = self._own_overlap(records, employee.id, data.start_date, data.end_date)
        if own:
            problems.append(f"You already have leave from {own.start_date:%d %b} to {own.end_date:%d %b} ({own.id}).")
        elif oh.has_overlapping_leave(emp_number, data.start_date, data.end_date):
            problems.append("You already have leave in these dates in OrangeHRM.")

        check = LeaveCheck(
            leave_type=data.leave_type, start_date=data.start_date, end_date=data.end_date, days=days, balance_before=left, balance_after=left - days,
            holidays_skipped=policy.holidays_skipped(data.start_date, data.end_date, work_week, holidays), problems=problems, ok=not problems,
        )
        return check, raw_balance

    def submit_leave(self, data: LeaveApplication) -> LeaveAttendanceRequest:
        employee = self._find_employee(data.employee_ref)
        today = date.today()
        check, raw_balance = self._check(employee, self._emp_number(employee), data, self._repo.list_all(), today)
        if not check.ok:
            raise ValidationFailedError(" ".join(check.problems))

        record = self._new_request(employee, RequestKind.LEAVE, data.reason)
        record.leave_type, record.start_date, record.end_date = data.leave_type, data.start_date, data.end_date
        record.leave_type_id, record.days, record.balance_after = self._leave_types()[data.leave_type], check.days, check.balance_after

        def guard(records: list[LeaveAttendanceRequest]) -> None:  # runs inside the store's lock: another request may have been saved meanwhile
            if own := self._own_overlap(records, employee.id, data.start_date, data.end_date):
                raise ValidationFailedError(f"You already have leave from {own.start_date:%d %b} to {own.end_date:%d %b} ({own.id}).")
            if check.days > raw_balance - self._held(records, employee.id, data.leave_type):
                raise ValidationFailedError(f"Not enough {data.leave_type} is left for {check.days} day(s).")

        return self._repo.add_if(record, guard)

    # ---------------------------------------------------------------- attendance
    def _waiting(self, records: list[LeaveAttendanceRequest], employee_id: str) -> set[date]:
        return {
            r.attendance_date for r in records
            if r.employee_id == employee_id and r.kind == RequestKind.REGULARIZATION and r.attendance_date and _holds_days(r)
        }

    def attendance(self, ref: str, day: date) -> AttendanceDayRecords:
        """The punch records OrangeHRM holds for ``day`` (an approved attendance request for the day replaces them)."""
        employee = self._find_employee(ref)
        records = self._gw.orangehrm.attendance_records(self._emp_number(employee), day, day)
        return AttendanceDayRecords(
            date=day, records=[PunchRecord(in_punch=r["inTime"] or "", out_punch=r["outTime"]) for r in records if r["inDate"] == day.isoformat()]
        )

    def submit_regularization(self, data: RegularizationApplication) -> LeaveAttendanceRequest:
        """An attendance request: the day and the in and out times the employee gives, recorded in OrangeHRM once approved."""
        employee = self._find_employee(data.employee_ref)
        if problem := policy.attendance_date_problem(data.attendance_date, date.today()):
            raise ValidationFailedError(problem)
        if policy.minutes(data.out_punch) <= policy.minutes(data.in_punch):
            raise ValidationFailedError(f"The out time must be after the in time ({data.in_punch}).")

        record = self._new_request(employee, RequestKind.REGULARIZATION, data.reason)
        record.attendance_date, record.in_punch, record.out_punch = data.attendance_date, data.in_punch, data.out_punch
        record.hours_worked = policy.hours_worked(data.in_punch, data.out_punch)

        def guard(records: list[LeaveAttendanceRequest]) -> None:
            if data.attendance_date in self._waiting(records, employee.id):
                raise ValidationFailedError("An attendance request for that day is already waiting for approval.")

        return self._repo.add_if(record, guard)

    # ------------------------------------------------------------------ approval
    def approve(self, request_id: str) -> LeaveAttendanceRequest:
        return self._decide(request_id, RequestStatus.APPROVED)

    def reject(self, request_id: str) -> LeaveAttendanceRequest:
        return self._decide(request_id, RequestStatus.REJECTED)

    def _decide(self, request_id: str, status: RequestStatus) -> LeaveAttendanceRequest:
        def mutate(r: LeaveAttendanceRequest) -> None:
            if r.status != RequestStatus.PENDING:
                raise ConflictError(f"{r.id} is already {r.status.value.lower()}.")
            r.status, r.decided_at = status, datetime.now()

        return self._repo.update(request_id, mutate)

    def apply(self, request_id: str) -> LeaveAttendanceRequest:
        """Record an approved request in OrangeHRM: book the leave, or punch the employee out. Safe to call again: it never records twice."""
        with self._apply_lock:
            record = self._repo.require(request_id)
            if record.status != RequestStatus.APPROVED:
                raise ConflictError("Only an approved request can be recorded in OrangeHRM.")
            if record.applied:
                return record
            employee = self._find_employee(record.employee_id)
            emp_number = self._emp_number(employee)
            oh = self._gw.orangehrm
            if record.kind == RequestKind.LEAVE:
                result = oh.assign_leave(emp_number, record.leave_type_id, record.start_date, record.end_date, f"{_DEMO_NOTE}: {record.reason}")
            else:
                self._record_attendance(emp_number, record)
                result = {"id": None, "url": oh.attendance_url()}

            def mutate(r: LeaveAttendanceRequest) -> None:
                r.applied, r.applied_at, r.orange_hrm_id, r.orange_hrm_url = True, datetime.now(), result["id"], result["url"]

            return self._repo.update(request_id, mutate)

    def _record_attendance(self, emp_number: int, record: LeaveAttendanceRequest) -> None:
        """Write the approved day to OrangeHRM: whatever it holds for the day is replaced by the punch-in and punch-out the employee gave.

        Replacing first also makes a retry safe: a half-written day (punched in, not out) is cleared before it is written again.
        """
        oh, day, note = self._gw.orangehrm, record.attendance_date, f"{_DEMO_NOTE}: {record.reason}"
        oh.delete_attendance_records(emp_number, [r["id"] for r in oh.attendance_records(emp_number, day, day) if r["inDate"] == day.isoformat()])
        oh.punch_in(emp_number, day, record.in_punch, note)
        oh.punch_out(emp_number, day, record.out_punch, note)

    def clear(self) -> int:
        """Delete decided requests from the portal. What was recorded in OrangeHRM stays there."""
        return self._repo.delete_where(lambda r: r.status in _FINAL)

    # ------------------------------------------------------------------- helpers
    def _new_request(self, employee: Employee, kind: RequestKind, reason: str) -> LeaveAttendanceRequest:
        existing = {r.id for r in self._repo.list_all()}
        prefix = "LV" if kind == RequestKind.LEAVE else "AT"
        while True:
            candidate = f"{prefix}-{secrets.randbelow(900_000) + 100_000}"
            if candidate not in existing:
                break
        return LeaveAttendanceRequest(
            id=candidate, kind=kind, employee_id=employee.id, full_name=employee.full_name, work_email=_work_email(employee),
            department=employee.department, job_title=employee.job_title, manager=employee.manager, reason=reason,
        )

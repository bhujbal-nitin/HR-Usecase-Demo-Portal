"""Leave & attendance schemas: what the chat sends, what it gets back, and the stored request."""

import re
from datetime import date, datetime
from enum import StrEnum

from pydantic import Field, field_validator, model_validator

from app.schemas.common import CamelModel

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class RequestKind(StrEnum):
    LEAVE = "leave"
    REGULARIZATION = "regularization"


class RequestStatus(StrEnum):
    PENDING = "Pending Approval"
    APPROVED = "Approved"
    REJECTED = "Rejected"


# ------------------------------------------------------------------ what the chat sends
class LeaveCheckRequest(CamelModel):
    employee_ref: str = Field(min_length=3, max_length=120)
    leave_type: str = Field(min_length=2, max_length=40)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _order(self) -> "LeaveCheckRequest":
        if self.end_date < self.start_date:
            raise ValueError("The end date cannot be before the start date.")
        return self


class LeaveApplication(LeaveCheckRequest):
    reason: str = Field(min_length=2, max_length=300)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class RegularizationApplication(CamelModel):
    """An attendance request: the day, when the employee came in and when they left."""

    employee_ref: str = Field(min_length=3, max_length=120)
    attendance_date: date
    in_punch: str = Field(description="The time you came in, HH:MM (24 hour)")
    out_punch: str = Field(description="The time you left, HH:MM (24 hour)")
    reason: str = Field(min_length=2, max_length=300)

    @field_validator("in_punch", "out_punch")
    @classmethod
    def _time(cls, value: str) -> str:
        value = value.strip()
        if not _TIME.match(value):
            raise ValueError("Enter the time as HH:MM, for example 18:30.")
        return value

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


# ---------------------------------------------------------------- what the chat gets back
class LeaveOptions(CamelModel):
    leave_types: list[str]
    shift_end: str  # the usual end of the working day, proposed as the out-punch


class LeaveBalance(CamelModel):
    """From OrangeHRM. ``pending`` is leave asked for in this portal that is not in OrangeHRM yet; ``left`` already takes it off."""

    leave_type: str
    total: float
    used: float
    pending: float
    left: float


class Holiday(CamelModel):
    date: date
    name: str


class LeaveCheck(CamelModel):
    """The balance and policy checks for a leave request, before it is submitted."""

    leave_type: str
    start_date: date
    end_date: date
    days: int
    balance_before: float
    balance_after: float
    holidays_skipped: list[Holiday] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    ok: bool


class PunchRecord(CamelModel):
    in_punch: str
    out_punch: str | None  # None: no out-punch was recorded


class AttendanceDayRecords(CamelModel):
    """What OrangeHRM already holds for one day; an approved attendance request replaces it."""

    date: date
    records: list[PunchRecord]


# ----------------------------------------------------------------------- the stored request
class LeaveAttendanceRequest(CamelModel):
    """One leave application or one attendance correction, waiting for or past its approval. Persisted as JSON."""

    id: str
    kind: RequestKind
    employee_id: str
    full_name: str
    work_email: str
    department: str
    job_title: str
    manager: str
    reason: str

    # leave
    leave_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    leave_type_id: int | None = None  # the leave type in OrangeHRM
    days: int | None = None
    balance_after: float | None = None

    # attendance correction
    attendance_date: date | None = None
    in_punch: str | None = None
    out_punch: str | None = None
    hours_worked: str | None = None  # e.g. "9h 18m"

    status: RequestStatus = RequestStatus.PENDING
    submitted_at: datetime = Field(default_factory=datetime.now)
    decided_at: datetime | None = None

    # recorded in OrangeHRM once approved (see LeaveService.apply)
    applied: bool = False
    applied_at: datetime | None = None
    orange_hrm_id: int | None = None  # the leave request created in OrangeHRM
    orange_hrm_url: str | None = None


class LeaveWorkflowRun(CamelModel):
    """The outcome of one showcase AutomationEdge workflow: ``ok`` only when the instance reached Complete."""

    workflow_name: str
    status: str
    ok: bool
    automation_request_id: int | None = None
    agent: str | None = None
    message: str = ""
    instance_url: str | None = None

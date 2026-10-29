"""Employee offboarding (resignation) schemas."""

from datetime import date, datetime
from enum import StrEnum
from typing import Any

from pydantic import Field, field_validator

from app.schemas.common import CamelModel
from app.schemas.employee import IntakeStatus, PipelineStep, ProvisioningStatus

RESIGNATION_REASONS = (
    "Better opportunity",
    "Higher studies",
    "Relocation",
    "Health or personal reasons",
    "Career change",
    "Other",
)


class OffboardingStatus(StrEnum):
    PENDING_REVIEW = "Pending Review"
    PROCESSING = "Processing"
    COMPLETED = "Completed"
    REJECTED = "Rejected"
    FAILED = "Offboarding Failed"  # the chain stopped at a failed step


class ResignationCreate(CamelModel):
    """What the employee submits in the chat."""

    employee_ref: str = Field(min_length=3, max_length=120, description="Employee ID or e-mail address")
    last_working_day: date
    reason: str = Field(min_length=2, max_length=80)
    comments: str = Field(default="", max_length=500)
    leave_balance_days: int = Field(default=0, ge=0, le=365)

    @field_validator("employee_ref", "reason", "comments")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class EmployeeSummary(CamelModel):
    """The little the chat shows back when it recognises an employee."""

    employee_id: str
    full_name: str
    department: str
    job_title: str
    manager: str
    work_email: str


class Offboarding(CamelModel):
    """One resignation going through offboarding. Persisted as JSON."""

    id: str
    employee_id: str
    full_name: str
    work_email: str
    personal_email: str
    department: str
    job_title: str
    manager: str
    hardware: str
    annual_ctc: int
    emp_number: int | None = None  # OrangeHRM profile, when known from onboarding
    user_principal_name: str | None = None  # Microsoft 365 account, when known from onboarding

    reason: str
    comments: str = ""
    resignation_date: date = Field(default_factory=date.today)
    last_working_day: date
    notice_period_days: int
    leave_balance_days: int = 0

    status: OffboardingStatus = OffboardingStatus.PENDING_REVIEW
    submitted_at: datetime = Field(default_factory=datetime.now)
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    completed_at: datetime | None = None

    intake: list[PipelineStep] = Field(default_factory=list)
    intake_status: IntakeStatus = IntakeStatus.NOT_STARTED
    pipeline: list[PipelineStep] = Field(default_factory=list)
    pipeline_status: ProvisioningStatus = ProvisioningStatus.NOT_STARTED

    relieving_letter: dict[str, Any] | None = None

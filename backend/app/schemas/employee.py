"""Candidate / employee onboarding schemas."""

import re
from datetime import date, datetime
from enum import StrEnum
from typing import Any

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import CamelModel

DOCUMENT_KEYS = ("idDoc", "panDoc", "uanDoc", "salaryDoc")
REQUIRED_DOCUMENT_KEYS = ("idDoc", "panDoc", "salaryDoc")  # the EPFO UAN card is optional
DOCUMENT_LABELS = {
    "idDoc": "Aadhaar Card",
    "panDoc": "PAN Card",
    "uanDoc": "EPFO UAN Card",
    "salaryDoc": "Latest Salary Slip",
}


class EmployeeStatus(StrEnum):
    PENDING_REVIEW = "Pending Review"
    PROCESSING = "Processing Approval"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    FAILED = "Provisioning Failed"  # the provisioning chain stopped at a failed step


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class ProvisioningStatus(StrEnum):
    NOT_STARTED = "not_started"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    FAILED = "failed"


class IntakeStatus(StrEnum):
    """State of the intake chain that runs after submit (ServiceNow request, then candidate-details workflow)."""

    NOT_STARTED = "not_started"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class CandidateCreate(CamelModel):
    """Fields submitted by the onboarding wizard (multipart form)."""

    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=5, max_length=30)
    dob: date
    aadhaar: str
    uan: str = ""  # optional
    emergency_name: str = Field(min_length=2, max_length=120)
    emergency_phone: str = Field(min_length=5, max_length=30)
    address: str = Field(min_length=5, max_length=300)
    department: str = Field(min_length=2, max_length=80)
    job_title: str = Field(min_length=2, max_length=120)
    manager: str = Field(min_length=2, max_length=120)
    start_date: date
    annual_ctc: int = Field(gt=0, le=1_000_000_000, description="Annual CTC in INR")
    hardware: str = Field(min_length=2, max_length=120)
    work_location: str = Field(default="Hybrid", max_length=80)

    @field_validator("full_name", "emergency_name", "address", "department", "job_title", "manager", "hardware")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("phone", "emergency_phone")
    @classmethod
    def _phone_has_ten_digits(cls, value: str) -> str:
        if len(re.sub(r"\D", "", value)) < 10:
            raise ValueError("must contain at least 10 digits")
        return value.strip()

    @field_validator("aadhaar", "uan")
    @classmethod
    def _twelve_digits(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not digits and not value.strip():
            return ""  # only the optional UAN can be blank; Aadhaar is rejected below
        if len(digits) != 12:
            raise ValueError("must be exactly 12 digits")
        return digits

    @field_validator("dob")
    @classmethod
    def _dob_in_past(cls, value: date) -> date:
        if value >= date.today():
            raise ValueError("must be in the past")
        return value


class StoredDocument(CamelModel):
    key: str
    label: str
    filename: str
    stored_name: str
    content_type: str
    size: int


class PipelineStep(CamelModel):
    key: str
    label: str
    system: str
    status: StepStatus = StepStatus.PENDING
    message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    details: dict[str, Any] = Field(default_factory=dict)


def step_is_done(step: "PipelineStep") -> bool:
    """A step that does not need to run again: it succeeded, or a person chose to skip it."""
    return step.status == StepStatus.SUCCESS or (step.status == StepStatus.SKIPPED and bool(step.details.get("skippedByUser")))


def mark_skipped_by_user(step: "PipelineStep") -> None:
    step.status, step.message, step.details = StepStatus.SKIPPED, "Skipped by HR.", {"skippedByUser": True}
    step.finished_at = step.finished_at or datetime.now()


class WorkflowRun(CamelModel):
    """One AutomationEdge T4 workflow execution."""

    workflow_name: str
    automation_request_id: int | None = None
    execution_status: str | None = None
    agent_name: str | None = None
    message: str | None = None
    instance_url: str | None = None
    response: dict[str, Any] | None = None
    executed_at: datetime = Field(default_factory=datetime.now)


class ServiceNowInfo(CamelModel):
    req_number: str | None = None
    ritm_number: str | None = None
    req_sys_id: str | None = None
    ritm_sys_id: str | None = None
    req_url: str | None = None
    ritm_url: str | None = None
    approval_status: str = "Pending Sync"
    stage: str = "HR Document Verification"
    attached_documents: list[str] = Field(default_factory=list)
    sync_error: str | None = None


class Office365Info(CamelModel):
    user_id: str | None = None
    user_principal_name: str | None = None
    display_name: str | None = None
    initial_password: str | None = None
    admin_url: str | None = None
    already_existed: bool = False


class OrangeHrmInfo(CamelModel):
    emp_number: int | None = None
    employee_id: str | None = None
    work_email: str | None = None
    profile_url: str | None = None
    attached_documents: list[str] = Field(default_factory=list)


class LaptopInfo(CamelModel):
    ticket_number: str | None = None
    ticket_url: str | None = None
    hardware: str | None = None


class Employee(CamelModel):
    """A candidate going through onboarding. Persisted as JSON."""

    id: str
    full_name: str
    email: str
    phone: str
    dob: date
    aadhaar: str
    uan: str = ""
    emergency_name: str
    emergency_phone: str
    address: str
    department: str
    job_title: str
    manager: str
    start_date: date
    annual_ctc: int
    hardware: str
    work_location: str = "Hybrid"

    documents: dict[str, StoredDocument] = Field(default_factory=dict)
    signature_file: str | None = None

    status: EmployeeStatus = EmployeeStatus.PENDING_REVIEW
    provisioning_status: ProvisioningStatus = ProvisioningStatus.NOT_STARTED
    submitted_at: datetime = Field(default_factory=datetime.now)
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    approval_source: str | None = None

    service_now: ServiceNowInfo = Field(default_factory=ServiceNowInfo)
    workflow_runs: list[WorkflowRun] = Field(default_factory=list)
    intake: list[PipelineStep] = Field(default_factory=list)
    intake_status: IntakeStatus = IntakeStatus.NOT_STARTED
    pipeline: list[PipelineStep] = Field(default_factory=list)
    office365: Office365Info | None = None
    orange_hrm: OrangeHrmInfo | None = None
    laptop: LaptopInfo | None = None

    @property
    def first_name(self) -> str:
        return self.full_name.split(None, 1)[0] if self.full_name.strip() else "Employee"

    @property
    def last_name(self) -> str:
        parts = self.full_name.split()
        return parts[-1] if len(parts) > 1 else (parts[0] if parts else "Employee")


class AutofillProfile(CamelModel):
    """Sample candidate data for the demo 'Auto-Fill' button."""

    full_name: str
    email: str
    phone: str
    dob: date
    aadhaar: str
    uan: str
    emergency_name: str
    emergency_phone: str
    address: str
    department: str
    job_title: str
    manager: str
    start_date: date
    annual_ctc: int
    hardware: str
    work_location: str


class ClearScope(StrEnum):
    PROCESSED = "processed"
    ALL = "all"

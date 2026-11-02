"""Reimbursement & benefits schemas: the bills read from uploads, and the stored claim."""

from datetime import date as Date
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import CamelModel
from app.schemas.leave import RequestStatus


class ExpenseItem(CamelModel):
    """One bill: what the reader found on it, and (once the manager has decided) whether it was approved."""

    file_name: str = Field(max_length=200)
    expense_type: str  # Travel | Food | Mobile | Stay | Medical | Others
    date: Date | None = None  # the date printed on the bill
    amount: float = Field(gt=0, le=10_000_000)  # the final amount due, in INR
    vendor: str = Field(max_length=120)
    within_policy: bool = False  # Travel and Food are within the company's reimbursement policy; the manager can approve any bill
    approved: bool | None = None  # None until the manager decides

    @field_validator("vendor", "file_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class ClaimSubmission(CamelModel):
    """What the chat sends when the employee submits the claim: who, and the bills read so far."""

    employee_ref: str = Field(min_length=3, max_length=120)
    items: list[ExpenseItem] = Field(min_length=1, max_length=20)


class ClaimDecision(CamelModel):
    """The manager's choice of bills: the positions (0-based) of the bills to approve; the others are rejected. Omitted: approve them all."""

    approved_bills: list[int] | None = None


class ReimbursementClaim(CamelModel):
    """One expense claim, waiting for or past the manager's decision. Persisted as JSON."""

    id: str
    employee_id: str
    full_name: str
    work_email: str
    department: str
    job_title: str
    manager: str
    items: list[ExpenseItem]
    total_amount: float  # every bill
    approved_total: float | None = None  # the bills the manager approved (None until decided)
    status: RequestStatus = RequestStatus.PENDING
    submitted_at: datetime = Field(default_factory=datetime.now)
    decided_at: datetime | None = None

    # recorded in OrangeHRM (Claim) once approved
    applied: bool = False
    applied_at: datetime | None = None
    orange_hrm_id: int | None = None  # the claim request created in OrangeHRM
    orange_hrm_url: str | None = None
    expenses_recorded: int = 0  # how many of the approved bills are already in that claim (so a retry carries on, not starts over)

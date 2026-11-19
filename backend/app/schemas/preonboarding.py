"""Pre-onboarding schemas: the offer, the candidate's acceptance and personal details, their seven documents, the (dummy) background check,
HR's approval, the joining letter, and the stored record."""

import re
from datetime import date as Date
from datetime import datetime
from enum import StrEnum

from pydantic import Field, field_validator

from app.schemas.common import CamelModel

# The seven documents, in the order they are asked for: key -> label. (Records made before the cancelled cheque was dropped may still hold one.)
DOCUMENT_LABELS: dict[str, str] = {
    "tenth": "10th marksheet",
    "twelfth": "12th marksheet",
    "degree": "Degree certificate",
    "aadhaar": "Aadhaar card",
    "pan": "PAN card",
    "photo": "Passport photo",
    "resume": "Resume",
}
DOCUMENT_KEYS = tuple(DOCUMENT_LABELS)
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


GENDERS = ("Female", "Male", "Other")
MARITAL_STATUSES = ("Single", "Married", "Divorced", "Widowed")
MIN_AGE = 18


class PreStatus(StrEnum):
    """Where the candidate is: offer released, offer accepted, collecting documents (after the personal details), awaiting HR approval, approved,
    joining confirmed, completed; or rejected. The last two members are only for records made by the earlier flow, so they still load."""

    OFFER_RELEASED = "Offer released"
    OFFER_ACCEPTED = "Offer accepted"
    COLLECTING = "Collecting documents"
    AWAITING_HR = "Awaiting HR approval"
    APPROVED = "Approved"
    JOINING_CONFIRMED = "Joining confirmed"
    COMPLETED = "Completed"
    REJECTED = "Rejected"
    AWAITING_REVIEW = "Awaiting review"  # earlier flow only
    OFFER_SENT = "Offer sent"  # earlier flow only


class Decision(StrEnum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class CandidateStart(CamelModel):
    """What is typed at the start of the demo."""

    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=200)
    phone: str = Field(min_length=5, max_length=30)
    designation: str = Field(min_length=1, max_length=120)
    department: str = Field(min_length=1, max_length=120)
    manager: str = Field(min_length=1, max_length=120)
    location: str = Field(min_length=1, max_length=120)
    annual_ctc: int = Field(gt=0, le=100_000_000)
    joining_date: Date

    @field_validator("full_name", "email", "phone", "designation", "department", "manager", "location")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This cannot be empty.")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        if not _EMAIL.match(value):
            raise ValueError("Enter a valid e-mail address.")
        return value


class DocumentCheck(CamelModel):
    passed: bool
    readable: bool = True
    document_type: str = "other"
    name_on_document: str | None = None
    name_matches: bool | None = None  # None where no name applies (the photo)
    issues: list[str] = Field(default_factory=list)


class PreDocument(CamelModel):
    key: str
    label: str
    file_name: str
    content_type: str
    uploaded_at: datetime = Field(default_factory=datetime.now)
    check: DocumentCheck


class VerificationRow(CamelModel):
    key: str
    label: str
    name: str | None = None
    matches: bool
    note: str = ""


class Verification(CamelModel):
    all_match: bool
    checked_at: datetime = Field(default_factory=datetime.now)
    rows: list[VerificationRow]


class ReviewState(CamelModel):
    """The document reviewer's decision. The reviewer step no longer exists; this is kept so records made by the earlier flow still load."""

    status: Decision = Decision.PENDING
    reviewer: str | None = None
    decided_at: datetime | None = None
    note: str | None = None


class HrState(CamelModel):
    """HR's decision on the candidate's pre-onboarding details (the only human step)."""

    status: Decision = Decision.PENDING
    approver: str | None = None
    decided_at: datetime | None = None
    note: str | None = None


class ServiceNowRef(CamelModel):
    req_number: str | None = None
    req_url: str | None = None
    req_sys_id: str | None = None
    ritm_sys_id: str | None = None
    error: str | None = None


class Offer(CamelModel):
    letter_no: str
    file_name: str
    generated_at: datetime = Field(default_factory=datetime.now)
    sent_to: str | None = None
    sent_at: datetime | None = None


def _clean(value: str, minimum: int, what: str) -> str:
    value = (value or "").strip()
    if len(value) < minimum:
        raise ValueError(f"{what} must be at least {minimum} characters.")
    return value


class PersonalInfo(CamelModel):
    """Step 4: what the candidate fills in about themselves (the job details were entered by HR with the offer)."""

    date_of_birth: Date
    gender: str
    marital_status: str
    current_address: str = Field(max_length=300)
    permanent_address: str = Field(max_length=300)
    emergency_name: str = Field(max_length=120)
    emergency_relation: str = Field(max_length=60)
    emergency_phone: str = Field(max_length=30)

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, value: Date) -> Date:
        today = Date.today()
        if value >= today:
            raise ValueError("The date of birth cannot be today or in the future.")
        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if age < MIN_AGE:
            raise ValueError(f"The candidate must be at least {MIN_AGE} years old.")
        if age > 100:
            raise ValueError("Enter a valid date of birth.")
        return value

    @field_validator("gender")
    @classmethod
    def _gender(cls, value: str) -> str:
        if value not in GENDERS:
            raise ValueError(f"Choose one of: {', '.join(GENDERS)}.")
        return value

    @field_validator("marital_status")
    @classmethod
    def _marital(cls, value: str) -> str:
        if value not in MARITAL_STATUSES:
            raise ValueError(f"Choose one of: {', '.join(MARITAL_STATUSES)}.")
        return value

    @field_validator("current_address", "permanent_address")
    @classmethod
    def _address(cls, value: str) -> str:
        return _clean(value, 5, "The address")

    @field_validator("emergency_name", "emergency_relation")
    @classmethod
    def _names(cls, value: str) -> str:
        return _clean(value, 2, "This")

    @field_validator("emergency_phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        value = value.strip()
        if sum(ch.isdigit() for ch in value) < 8:
            raise ValueError("Enter a phone number with at least 8 digits.")
        return value


class AcceptRequest(CamelModel):
    """Step 2: the candidate accepts the offer and confirms the date of joining (left out = the date in the offer)."""

    joining_date: Date | None = None


class Acceptance(CamelModel):
    accepted_at: datetime = Field(default_factory=datetime.now)
    joining_date: Date


class BgvCheck(CamelModel):
    name: str
    result: str = "Clear"
    note: str = ""


class Bgv(CamelModel):
    """Step 6, background verification. A dummy: it is made up by the portal and always comes back clear."""

    status: str = "Clear"
    checked_at: datetime = Field(default_factory=datetime.now)
    checks: list[BgvCheck] = Field(default_factory=list)


class Joining(CamelModel):
    """Step 8, the joining-instructions letter."""

    file_name: str
    sent_to: str | None = None
    sent_at: datetime | None = None


class PreCandidate(CamelModel):
    """One candidate in pre-onboarding. Persisted (JSON file or PostgreSQL)."""

    id: str
    full_name: str
    email: str
    phone: str
    designation: str
    department: str
    manager: str
    location: str
    annual_ctc: int
    joining_date: Date
    status: PreStatus = PreStatus.OFFER_RELEASED
    documents: dict[str, PreDocument] = Field(default_factory=dict)
    verification: Verification | None = None
    personal: PersonalInfo | None = None
    acceptance: Acceptance | None = None
    bgv: Bgv | None = None
    joining: Joining | None = None
    review: ReviewState = Field(default_factory=ReviewState)
    hr: HrState = Field(default_factory=HrState)
    service_now: ServiceNowRef = Field(default_factory=ServiceNowRef)
    offer: Offer | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: datetime | None = None


class DecisionNote(CamelModel):
    """An optional note sent with an approval or a rejection."""

    note: str | None = Field(default=None, max_length=500)


class DispatchRequest(CamelModel):
    to: str | None = Field(default=None, max_length=200)

    @field_validator("to")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _EMAIL.match(value.strip()):
            raise ValueError("Enter a valid e-mail address.")
        return value.strip()


class DocumentResult(CamelModel):
    """The answer to one document upload: what the check found, and whether the file was accepted."""

    document: PreDocument
    accepted: bool
    record: PreCandidate


class ClearResponse(CamelModel):
    removed: int

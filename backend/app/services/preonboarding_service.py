"""Use-cases for pre-onboarding, in the order the candidate goes through them: the offer (made and e-mailed), the candidate's acceptance and date of joining,
their personal details, their seven documents (read with Gemini, names compared), the background check (a dummy), HR's approval, the joining-instructions
letter (made and e-mailed) and the completion.

Every step is real except the background check: each document is read with Google Gemini, a ServiceNow request is raised at the start (the documents,
the letters and every step are put on it, and it is closed when pre-onboarding completes), HR approves on the portal's Approvals page, and the two letters
are PDFs in the portal's document theme, e-mailed to the candidate. Records live in the JSON file or the database (see ``container``).
"""

import logging
import secrets
import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from html import escape
from pathlib import Path

from app.core.config import Settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.core.request_context import NO_LOGIN, current_user, feature
from app.integrations.gemini_documents import GeminiDocumentReader
from app.integrations.mailer import Mailer
from app.integrations.servicenow import Attachment, ServiceNowClient
from app.schemas.preonboarding import (
    DOCUMENT_KEYS,
    DOCUMENT_LABELS,
    Acceptance,
    Bgv,
    BgvCheck,
    CandidateStart,
    Decision,
    DocumentResult,
    Joining,
    Offer,
    PersonalInfo,
    PreCandidate,
    PreDocument,
    PreStatus,
    Verification,
    VerificationRow,
)
from app.services.payroll.slips import COMPANY
from app.services.preonboarding.checks import check_document
from app.services.preonboarding.joining import make_joining_letter
from app.services.preonboarding.offer import make_offer_letter
from app.utils.formatting import safe_filename

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx"}
_MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
_FINISHED = {PreStatus.REJECTED, PreStatus.COMPLETED, PreStatus.OFFER_SENT}  # offer-sent: records of the earlier flow
DEFAULT_APPROVER = "HR"


@dataclass
class PreOnboardingGateways:
    settings: Settings
    servicenow: ServiceNowClient
    reader: GeminiDocumentReader
    mailer: Mailer


def _who(default: str) -> str:
    user = current_user.get()
    return user if user and user != NO_LOGIN else default


class PreOnboardingService:
    def __init__(self, repository, gateways: PreOnboardingGateways):
        self._repo = repository
        self._gw = gateways
        self._lock = threading.Lock()  # making each letter and e-mailing it must each happen once

    # ------------------------------------------------------------------ files
    def _folder(self, candidate_id: str) -> Path:
        return self._gw.settings.preonboarding_dir / safe_filename(candidate_id)

    @staticmethod
    def _stored_name(document: PreDocument) -> str:
        return f"{document.key}{Path(document.file_name).suffix.lower()}"

    # ------------------------------------------------------------- ServiceNow
    def _sn_ready(self, candidate: PreCandidate) -> bool:
        return bool(candidate.service_now.req_sys_id) and self._gw.servicenow.is_configured()

    def _sn(self, candidate: PreCandidate, what: str, action: Callable[[str], None]) -> None:
        """Do something on the candidate's ServiceNow request. The request is a record of the work, so a failure here never stops the demo."""
        if not self._sn_ready(candidate):
            return
        try:
            action(candidate.service_now.req_sys_id)
        except Exception as exc:  # noqa: BLE001 - best effort
            logger.warning("ServiceNow %s failed for %s: %s", what, candidate.id, exc)

    def _note(self, candidate: PreCandidate, text: str) -> None:
        self._sn(candidate, "work note", lambda sys_id: self._gw.servicenow.add_note_to_request(sys_id, text))

    @staticmethod
    def _summary(candidate: PreCandidate) -> str:
        return (
            "Pre-onboarding candidate:\n"
            f"  - Full name: {candidate.full_name}\n  - Candidate ID: {candidate.id}\n  - Designation: {candidate.designation}\n"
            f"  - Department: {candidate.department}\n  - Reporting manager: {candidate.manager}\n  - Location: {candidate.location}\n"
            f"  - Date of joining: {candidate.joining_date.isoformat()}\n\n"
            "Required documents: " + ", ".join(DOCUMENT_LABELS.values()) + ".\n"
            "Steps: the offer letter is sent, the candidate accepts and confirms the date of joining, fills in personal details and uploads the documents "
            "(read and the name checked), the background check is done, HR approves, the joining instructions are sent and pre-onboarding is completed."
        )

    # ------------------------------------------------------------------ reads
    def list_candidates(self) -> list[PreCandidate]:
        return self._repo.list_all()

    def get(self, candidate_id: str) -> PreCandidate:
        return self._repo.require(candidate_id)

    def document_path(self, candidate_id: str, key: str) -> tuple[Path, PreDocument]:
        document = self._repo.require(candidate_id).documents.get(key)
        if document is None:
            raise NotFoundError("That document was not uploaded for this candidate.")
        path = self._folder(candidate_id) / self._stored_name(document)
        if not path.is_file():
            raise NotFoundError(f"The {document.label.lower()} is no longer available on the server.")
        return path, document

    # ----------------------------------------------------------------- create
    def create(self, data: CandidateStart) -> PreCandidate:
        existing = {c.id for c in self._repo.list_all()}
        while (candidate_id := f"PRE-{secrets.randbelow(900_000) + 100_000}") in existing:
            pass
        candidate = PreCandidate(id=candidate_id, **data.model_dump())
        try:
            if not self._gw.servicenow.is_configured():
                candidate.service_now.error = "ServiceNow is not configured, so no request was raised."
            else:
                request = self._gw.servicenow.create_prehire_request(candidate, self._summary(candidate))
                ref = candidate.service_now
                ref.req_number, ref.req_url, ref.req_sys_id, ref.ritm_sys_id = request.req_number, request.req_url, request.req_sys_id, request.ritm_sys_id
        except Exception as exc:  # noqa: BLE001 - a ServiceNow problem is shown on the record, it does not stop the candidate
            logger.warning("ServiceNow request for %s failed: %s", candidate.id, exc)
            candidate.service_now.error = str(exc)
        return self._repo.add(candidate)

    # -------------------------------------------------------------- documents
    def upload_document(self, candidate_id: str, key: str, filename: str, content: bytes, content_type: str | None) -> DocumentResult:
        """Read one document. If it passes it is kept (a document sent again replaces the earlier one); if not, it is reported and not kept."""
        if key not in DOCUMENT_KEYS:
            raise ValidationFailedError("Unknown document type.")
        label = DOCUMENT_LABELS[key]
        candidate = self._repo.require(candidate_id)
        self._require_collecting(candidate)
        extension = Path(filename or "").suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise ValidationFailedError(f"{label}: send a PDF, an image (.png, .jpg, .webp) or a Word (.docx) file.")
        if not content:
            raise ValidationFailedError(f"{label}: the uploaded file is empty.")
        limit = self._gw.settings.max_upload_bytes
        if len(content) > limit:
            raise ValidationFailedError(f"{label}: the file is larger than {limit // (1024 * 1024)} MB.")
        if extension == ".pdf" and not content.lstrip().startswith(b"%PDF"):
            raise ValidationFailedError(f"{label}: that is not a valid PDF file.")

        content_type = _MIME[extension]
        with feature("Pre-onboarding document check"):
            check = check_document(
                self._gw.reader, key, filename, content, content_type, candidate.full_name, self._gw.settings.document_name_match_threshold
            )
        document = PreDocument(key=key, label=label, file_name=safe_filename(Path(filename).name), content_type=content_type, check=check)
        if not check.passed:
            self._note(candidate, f"{label} ({document.file_name}) did not pass the document check: {' '.join(check.issues)}")
            return DocumentResult(document=document, accepted=False, record=candidate)

        replaced = key in candidate.documents
        folder = self._folder(candidate_id)
        folder.mkdir(parents=True, exist_ok=True)

        def mutate(c: PreCandidate) -> None:
            self._require_collecting(c)
            c.documents[key] = document
            c.verification = None  # whatever was verified before no longer holds

        record = self._repo.update(candidate_id, mutate)
        for old in folder.glob(f"{key}.*"):
            old.unlink(missing_ok=True)
        (folder / self._stored_name(document)).write_bytes(content)

        name_part = "" if check.name_matches is None else (" The name matches." if check.name_matches else f" The name on it is “{check.name_on_document or 'not readable'}”.")
        self._sn(record, "attachment", lambda sys_id: self._gw.servicenow.attach_to_request(sys_id, Attachment(document.file_name, content, content_type)))
        self._note(record, f"{label} {'replaced by a new upload' if replaced else 'received and attached'} ({document.file_name}); document check passed.{name_part}")
        return DocumentResult(document=document, accepted=True, record=record)

    @staticmethod
    def _require_collecting(candidate: PreCandidate) -> None:
        if candidate.status != PreStatus.COLLECTING:
            raise ConflictError(f"{candidate.full_name} is not at the document step (status: {candidate.status.value.lower()}).")

    # ----------------------------------------------------------------- verify
    def verify(self, candidate_id: str) -> PreCandidate:
        """Cross-check the name on all seven documents. All match: the background check can run. Not all: the candidate has to fix the document."""
        def mutate(c: PreCandidate) -> None:
            self._require_collecting(c)
            missing = [DOCUMENT_LABELS[k] for k in DOCUMENT_KEYS if k not in c.documents or not c.documents[k].check.passed]
            if missing:
                raise ConflictError(f"Upload and pass every document first. Still needed: {', '.join(missing)}.")
            rows = []
            for key in DOCUMENT_KEYS:
                check = c.documents[key].check
                if check.name_matches is None:
                    rows.append(VerificationRow(key=key, label=DOCUMENT_LABELS[key], name=None, matches=True, note="No name to compare; the photo was checked."))
                elif check.name_matches:
                    rows.append(VerificationRow(key=key, label=DOCUMENT_LABELS[key], name=check.name_on_document, matches=True))
                else:
                    shown = f"“{check.name_on_document}”" if check.name_on_document else "no readable name"
                    rows.append(VerificationRow(key=key, label=DOCUMENT_LABELS[key], name=check.name_on_document, matches=False, note=f"Shows {shown}; expected “{c.full_name}”."))
            verification = Verification(all_match=all(r.matches for r in rows), rows=rows)
            c.verification = verification

        record = self._repo.update(candidate_id, mutate)
        verification = record.verification
        if verification and verification.all_match:
            self._note(record, "Name checked across all 7 documents: every document carries the candidate's name.")
        elif verification:
            wrong = ", ".join(r.label for r in verification.rows if not r.matches)
            self._note(record, f"Name check found a difference on: {wrong}. The candidate has to send the correct document.")
        return record

    # -------------------------------------------------------------- acceptance
    def accept(self, candidate_id: str, joining_date: date | None = None) -> PreCandidate:
        """The candidate accepts the offer (it must have been e-mailed) and confirms the date of joining."""
        candidate = self._repo.require(candidate_id)
        self._require_status(candidate, PreStatus.OFFER_RELEASED, "accept the offer")
        if candidate.offer is None or candidate.offer.sent_at is None:
            raise ConflictError("The offer letter has not been sent to the candidate yet.")
        chosen = joining_date or candidate.joining_date
        if chosen != candidate.joining_date:
            if chosen <= date.today():
                raise ValidationFailedError("The joining date must be a date in the future.")
            if chosen.weekday() == 6:
                raise ValidationFailedError("Sunday is a weekly off, so the joining date cannot be on a Sunday. Please choose another date.")

        def mutate(c: PreCandidate) -> None:
            self._require_status(c, PreStatus.OFFER_RELEASED, "accept the offer")
            c.acceptance = Acceptance(joining_date=chosen)
            c.joining_date = chosen
            c.status = PreStatus.OFFER_ACCEPTED

        record = self._repo.update(candidate_id, mutate)
        self._note(record, f"Offer accepted by the candidate. Date of joining confirmed: {chosen.isoformat()}.")
        return record

    # --------------------------------------------------------------- personal
    def save_personal(self, candidate_id: str, info: PersonalInfo) -> PreCandidate:
        """The candidate's personal details; the document step opens after them."""
        candidate = self._repo.require(candidate_id)
        self._require_status(candidate, PreStatus.OFFER_ACCEPTED, "give personal details")

        def mutate(c: PreCandidate) -> None:
            self._require_status(c, PreStatus.OFFER_ACCEPTED, "give personal details")
            c.personal = info
            c.status = PreStatus.COLLECTING

        record = self._repo.update(candidate_id, mutate)
        self._note(record, "Personal information received (date of birth, gender, marital status, addresses and emergency contact).")
        return record

    # -------------------------------------------------------------------- bgv
    def background_check(self, candidate_id: str) -> PreCandidate:
        """Background verification. A dummy: nothing is sent anywhere, and the result is always clear."""
        def mutate(c: PreCandidate) -> None:
            self._require_status(c, PreStatus.COLLECTING, "be background-checked")
            if c.verification is None or not c.verification.all_match:
                raise ConflictError("Upload every document and let the names be checked first.")
            address = c.personal.current_address if c.personal else "given"
            c.bgv = Bgv(checks=[
                BgvCheck(name="Identity", note="Aadhaar and PAN are genuine and belong to the candidate."),
                BgvCheck(name="Education", note="The 10th, 12th and degree records are in order."),
                BgvCheck(name="Employment", note="The employment history in the resume is in order."),
                BgvCheck(name="Address", note=f"The current address ({address}) is in order."),
            ])
            c.status = PreStatus.AWAITING_HR

        record = self._repo.update(candidate_id, mutate)
        self._note(record, "Background verification (dummy): identity, education, employment and address are clear. Waiting for HR approval.")
        return record

    @staticmethod
    def _require_status(candidate: PreCandidate, expected: PreStatus, doing: str) -> None:
        if candidate.status != expected:
            raise ConflictError(f"{candidate.full_name} cannot {doing} now (status: {candidate.status.value.lower()}).")

    # -------------------------------------------------------------- approvals
    def hr_decision(self, candidate_id: str, approve: bool, note: str | None = None) -> PreCandidate:
        """HR's decision on the candidate's pre-onboarding (the only human step)."""
        who = _who(DEFAULT_APPROVER)

        def mutate(c: PreCandidate) -> None:
            if c.status != PreStatus.AWAITING_HR:
                raise ConflictError(f"{c.full_name} is not waiting for HR approval (status: {c.status.value.lower()}).")
            c.hr.status = Decision.APPROVED if approve else Decision.REJECTED
            c.hr.approver, c.hr.decided_at, c.hr.note = who, datetime.now(), (note or "").strip() or None
            c.status = PreStatus.APPROVED if approve else PreStatus.REJECTED
            if not approve:
                c.completed_at = datetime.now()

        record = self._repo.update(candidate_id, mutate)
        if approve:
            self._note(record, f"Pre-onboarding approved by {who}. Joining instructions to follow.")
        else:
            self._reject_request(record, f"Pre-onboarding rejected by {who}.")
        return record

    def _reject_request(self, candidate: PreCandidate, why: str) -> None:
        self._sn(candidate, "rejection", lambda sys_id: self._gw.servicenow.reject_request(sys_id, candidate.full_name))
        self._note(candidate, why)

    # ------------------------------------------------------------------ offer
    def make_offer(self, candidate_id: str) -> PreCandidate:
        """Make the offer letter (a PDF). It is the first step, so no approval is needed. Asking again returns the same letter."""
        with self._lock:
            candidate = self._repo.require(candidate_id)
            if candidate.offer is not None:
                return candidate
            self._require_status(candidate, PreStatus.OFFER_RELEASED, "be given an offer letter")
            today = date.today()
            used = {c.offer.letter_no for c in self._repo.list_all() if c.offer}
            number = len(used) + 1
            while (letter_no := f"OFFER/{today.year}/{number:04d}") in used:
                number += 1
            content = make_offer_letter(candidate, letter_no, today)
            file_name = f"Offer_Letter_{safe_filename(candidate.full_name)}.pdf"
            folder = self._folder(candidate_id)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / file_name).write_bytes(content)

            def mutate(c: PreCandidate) -> None:
                if c.offer is None:
                    c.offer = Offer(letter_no=letter_no, file_name=file_name)

            record = self._repo.update(candidate_id, mutate)
        self._sn(record, "attachment", lambda sys_id: self._gw.servicenow.attach_to_request(sys_id, Attachment(file_name, content, "application/pdf")))
        self._note(record, f"Offer letter {letter_no} generated.")
        return record

    def offer_path(self, candidate_id: str) -> tuple[Path, str]:
        candidate = self._repo.require(candidate_id)
        if candidate.offer is None:
            raise NotFoundError("The offer letter has not been made yet.")
        path = self._folder(candidate_id) / candidate.offer.file_name
        if not path.is_file():
            raise NotFoundError("The offer letter is no longer available on the server.")
        return path, candidate.offer.file_name

    def dispatch(self, candidate_id: str, to: str | None = None) -> PreCandidate:
        """E-mail the offer letter. Nothing is marked as sent unless the e-mail really went. Asking again does not send it twice."""
        with self._lock:
            candidate = self._repo.require(candidate_id)
            if candidate.offer is None:
                raise ConflictError("Make the offer letter first.")
            if candidate.offer.sent_at is not None:
                return candidate
            self._require_status(candidate, PreStatus.OFFER_RELEASED, "be sent the offer")
            path, file_name = self.offer_path(candidate_id)
            recipient = to or candidate.email
            body = (
                f"<p>Dear {escape(candidate.full_name)},</p>"
                f"<p>We are pleased to offer you the position of <b>{escape(candidate.designation)}</b> at {escape(COMPANY)}. "
                f"Your offer letter ({escape(candidate.offer.letter_no)}) is attached. Please confirm that you accept it, and your date of joining, "
                f"by replying to this e-mail.</p><p>We look forward to welcoming you.</p><p>Human Resources<br>{escape(COMPANY)}</p>"
            )
            self._gw.mailer.send(recipient, f"Your offer letter from {COMPANY}", body, path)  # raises if the e-mail is not set up or fails

            def mutate(c: PreCandidate) -> None:
                if c.offer is not None and c.offer.sent_at is None:
                    c.offer.sent_to, c.offer.sent_at = recipient, datetime.now()

            record = self._repo.update(candidate_id, mutate)
        self._note(record, f"Offer letter {file_name} e-mailed to {recipient}.")
        return record

    # ---------------------------------------------------------------- joining
    def send_joining(self, candidate_id: str, to: str | None = None) -> PreCandidate:
        """Make the joining-instructions letter (a PDF) and e-mail it once HR has approved. Nothing is marked as sent unless the e-mail really went."""
        with self._lock:
            candidate = self._repo.require(candidate_id)
            if candidate.joining is not None and candidate.joining.sent_at is not None:
                return candidate
            self._require_status(candidate, PreStatus.APPROVED, "be sent the joining instructions")
            content = make_joining_letter(candidate, date.today())
            file_name = f"Joining_Instructions_{safe_filename(candidate.full_name)}.pdf"
            folder = self._folder(candidate_id)
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / file_name
            path.write_bytes(content)
            recipient = to or candidate.email
            joining_on = candidate.joining_date.strftime("%d %B %Y")
            body = (
                f"<p>Dear {escape(candidate.full_name)},</p>"
                f"<p>Your pre-onboarding is complete and your joining is confirmed for <b>{escape(joining_on)}</b>. "
                f"Your joining instructions are attached: please read them and bring what they list.</p>"
                f"<p>We look forward to welcoming you.</p><p>Human Resources<br>{escape(COMPANY)}</p>"
            )
            self._gw.mailer.send(recipient, f"Your joining instructions from {COMPANY}", body, path)  # raises if the e-mail is not set up or fails

            def mutate(c: PreCandidate) -> None:
                if c.joining is None or c.joining.sent_at is None:
                    c.joining = Joining(file_name=file_name, sent_to=recipient, sent_at=datetime.now())
                    c.status = PreStatus.JOINING_CONFIRMED

            record = self._repo.update(candidate_id, mutate)
        self._sn(record, "attachment", lambda sys_id: self._gw.servicenow.attach_to_request(sys_id, Attachment(file_name, content, "application/pdf")))
        self._note(record, f"Joining instructions {file_name} e-mailed to {recipient}. Joining confirmed for {candidate.joining_date.isoformat()}.")
        return record

    def joining_path(self, candidate_id: str) -> tuple[Path, str]:
        candidate = self._repo.require(candidate_id)
        if candidate.joining is None:
            raise NotFoundError("The joining instructions have not been made yet.")
        path = self._folder(candidate_id) / candidate.joining.file_name
        if not path.is_file():
            raise NotFoundError("The joining instructions are no longer available on the server.")
        return path, candidate.joining.file_name

    def complete(self, candidate_id: str) -> PreCandidate:
        """Onboarding initiation: pre-onboarding is completed and the ServiceNow request is closed. Asking again changes nothing."""
        with self._lock:
            candidate = self._repo.require(candidate_id)
            if candidate.status == PreStatus.COMPLETED:
                return candidate
            self._require_status(candidate, PreStatus.JOINING_CONFIRMED, "be completed")

            def mutate(c: PreCandidate) -> None:
                if c.status == PreStatus.JOINING_CONFIRMED:
                    c.status, c.completed_at = PreStatus.COMPLETED, datetime.now()

            record = self._repo.update(candidate_id, mutate)
        self._note(record, "Pre-onboarding completed. The candidate is ready to join and the employee onboarding can begin.")
        self._sn(record, "closing", lambda sys_id: self._gw.servicenow.close_request(sys_id, "Pre-onboarding complete: the candidate is ready to join."))
        return record

    # ------------------------------------------------------------------ clear
    def clear(self) -> int:
        """Delete finished candidates (rejected or completed) with their files. What was done in ServiceNow stays there."""
        removed = self._repo.delete_where(lambda c: c.status in _FINISHED)
        for candidate in removed:
            shutil.rmtree(self._folder(candidate.id), ignore_errors=True)
        return len(removed)

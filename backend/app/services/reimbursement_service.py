"""Use-cases for reimbursement claims.

The employee uploads bills of any kind in the chat; each is read with OpenAI (category, date, amount, vendor). Travel and Food are within the
company's reimbursement policy (policy.POLICY_TYPES), which the chat and the manager see as a hint: the manager approves or rejects each
bill. Once decided, the approved bills are recorded in OrangeHRM as a claim (Claim module): the event and the expense types are created there
if they are missing. The portal keeps the claim (the bills' details, not the files) so the manager can decide.
"""

import logging
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime

from app.core.config import Settings
from app.core.exceptions import ConflictError, ValidationFailedError
from app.integrations.orangehrm import OrangeHRMClient
from app.repositories.reimbursement_repository import ReimbursementRepository
from app.schemas.leave import RequestStatus
from app.schemas.offboarding import EmployeeSummary
from app.schemas.reimbursement import ClaimSubmission, ExpenseItem, ReimbursementClaim
from app.services.employee_directory import EmployeeDirectory, work_email
from app.services.reimbursement import policy
from app.services.reimbursement.bill_reader import BillReader

logger = logging.getLogger(__name__)

CLAIM_EVENT = "Employee Expense Reimbursement"
_DEMO_NOTE = "HR Demo Portal"
_FINAL = {RequestStatus.APPROVED, RequestStatus.REJECTED}


@dataclass
class ReimbursementGateways:
    settings: Settings
    orangehrm: OrangeHRMClient
    bills: BillReader


class ReimbursementService:
    def __init__(self, repository: ReimbursementRepository, directory: EmployeeDirectory, gateways: ReimbursementGateways):
        self._repo = repository
        self._dir = directory
        self._gw = gateways
        self._apply_lock = threading.Lock()  # recording a claim in OrangeHRM must never happen twice

    # ------------------------------------------------------------------- the chat
    def lookup(self, ref: str) -> EmployeeSummary:
        employee = self._dir.find(ref, "reimbursement claims")
        self._dir.require_still_employed(employee, "reimbursement claims")
        return self._dir.summary(employee)

    def read_bill(self, ref: str, filename: str, content: bytes, content_type: str | None) -> ExpenseItem:
        """Read one uploaded bill. Nothing is saved: the chat keeps the bills until the employee submits the claim."""
        self._dir.find(ref, "reimbursement claims")
        if not content:
            raise ValidationFailedError("That file is empty.")
        return self._gw.bills.read(filename, content, content_type)

    def submit(self, data: ClaimSubmission) -> ReimbursementClaim:
        """Save the claim for the manager. The policy flag is worked out here from each bill's category, whatever the chat sent."""
        employee = self._dir.find(data.employee_ref, "reimbursement claims")
        self._dir.require_still_employed(employee, "reimbursement claims")
        items = []
        for bill in data.items:
            expense_type = policy.normalise_type(bill.expense_type)
            items.append(bill.model_copy(update={"expense_type": expense_type, "within_policy": policy.within_policy(expense_type), "approved": None}))

        existing = {c.id for c in self._repo.list_all()}
        while (claim_id := f"RC-{secrets.randbelow(900_000) + 100_000}") in existing:
            pass
        claim = ReimbursementClaim(
            id=claim_id, employee_id=employee.id, full_name=employee.full_name, work_email=work_email(employee), department=employee.department,
            job_title=employee.job_title, manager=employee.manager, items=items, total_amount=policy.total(items),
        )
        return self._repo.add(claim)

    # ------------------------------------------------------------------ approval
    def list_claims(self) -> list[ReimbursementClaim]:
        return self._repo.list_all()

    def get_claim(self, claim_id: str) -> ReimbursementClaim:
        return self._repo.require(claim_id)

    def approve(self, claim_id: str, approved_bills: list[int] | None = None) -> ReimbursementClaim:
        """Approve the chosen bills (their positions, 0-based; omitted: all of them) and reject the rest. At least one must be approved."""
        def mutate(c: ReimbursementClaim) -> None:
            self._require_pending(c)
            chosen = set(range(len(c.items))) if approved_bills is None else set(approved_bills)
            if not chosen or not chosen <= set(range(len(c.items))):
                raise ValidationFailedError("Choose at least one of the claim's bills to approve, or reject the claim.")
            for index, item in enumerate(c.items):
                item.approved = index in chosen
            c.approved_total = policy.total([i for i in c.items if i.approved])
            c.status, c.decided_at = RequestStatus.APPROVED, datetime.now()

        return self._repo.update(claim_id, mutate)

    def reject(self, claim_id: str) -> ReimbursementClaim:
        def mutate(c: ReimbursementClaim) -> None:
            self._require_pending(c)
            for item in c.items:
                item.approved = False
            c.approved_total = 0.0
            c.status, c.decided_at = RequestStatus.REJECTED, datetime.now()

        return self._repo.update(claim_id, mutate)

    @staticmethod
    def _require_pending(claim: ReimbursementClaim) -> None:
        if claim.status != RequestStatus.PENDING:
            raise ConflictError(f"{claim.id} is already {claim.status.value.lower()}.")

    def clear(self) -> int:
        """Delete decided claims from the portal. What was recorded in OrangeHRM stays there."""
        return self._repo.delete_where(lambda c: c.status in _FINAL)

    # ---------------------------------------------------------------- OrangeHRM
    def apply(self, claim_id: str) -> ReimbursementClaim:
        """Record an approved claim in OrangeHRM. Safe to call again: it carries on where it stopped and never records twice."""
        with self._apply_lock:
            claim = self._repo.require(claim_id)
            if claim.status != RequestStatus.APPROVED:
                raise ConflictError("Only an approved claim can be recorded in OrangeHRM.")
            if claim.applied:
                return claim
            oh = self._gw.orangehrm
            employee = self._dir.find(claim.employee_id, "reimbursement claims")

            if claim.orange_hrm_id is None:  # a retry after a partial failure reuses the claim that was already created
                event_id = self._event_id()
                new_id = oh.assign_claim(self._dir.emp_number(employee), event_id, policy.CURRENCY, f"{_DEMO_NOTE}: claim {claim.id}")
                claim = self._repo.update(claim_id, lambda c: self._remember_claim(c, new_id))
            approved = [i for i in claim.items if i.approved]
            type_ids = self._expense_type_ids({i.expense_type for i in approved})
            for item in approved[claim.expenses_recorded:]:
                oh.add_claim_expense(claim.orange_hrm_id, type_ids[item.expense_type], item.date or claim.submitted_at.date(), item.amount, f"{item.vendor} ({item.file_name})")
                claim = self._repo.update(claim_id, self._count_expense)
            oh.submit_claim(claim.orange_hrm_id)
            return self._repo.update(claim_id, self._mark_applied)

    def _remember_claim(self, claim: ReimbursementClaim, new_id: int) -> None:
        claim.orange_hrm_id, claim.orange_hrm_url = new_id, self._gw.orangehrm.claim_url(new_id)

    @staticmethod
    def _count_expense(claim: ReimbursementClaim) -> None:
        claim.expenses_recorded += 1

    @staticmethod
    def _mark_applied(claim: ReimbursementClaim) -> None:
        claim.applied, claim.applied_at = True, datetime.now()

    def _event_id(self) -> int:
        oh = self._gw.orangehrm
        known = {e["name"]: e["id"] for e in oh.claim_events()}
        if CLAIM_EVENT not in known:
            known[CLAIM_EVENT] = oh.create_claim_event(CLAIM_EVENT)
            logger.info("Created the claim event '%s' in OrangeHRM", CLAIM_EVENT)
        return known[CLAIM_EVENT]

    def _expense_type_ids(self, needed: set[str]) -> dict[str, int]:
        """The OrangeHRM expense type of each category in ``needed``; one that is missing there is created."""
        oh = self._gw.orangehrm
        known = {t["name"]: t["id"] for t in oh.claim_expense_types()}
        for name in sorted(needed):
            if name not in known:
                known[name] = oh.create_claim_expense_type(name)
                logger.info("Created the expense type '%s' in OrangeHRM", name)
        return {name: known[name] for name in needed}

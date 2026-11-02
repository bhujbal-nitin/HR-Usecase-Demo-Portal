"""Reimbursement & benefits endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from starlette.datastructures import UploadFile

from app.api.deps import ContainerDep, SettingsDep
from app.api.workflow_runs import run_showcase_workflow
from app.core.exceptions import ValidationFailedError
from app.schemas.common import CamelModel
from app.schemas.leave import LeaveWorkflowRun
from app.schemas.offboarding import EmployeeSummary
from app.schemas.reimbursement import ClaimDecision, ClaimSubmission, ExpenseItem, ReimbursementClaim
from app.services.reimbursement_service import ReimbursementService

router = APIRouter(prefix="/reimbursement", tags=["reimbursement"])

Ref = Annotated[str, Query(min_length=3, max_length=120, description="Employee ID or e-mail address")]


def get_reimbursement_service(container: ContainerDep) -> ReimbursementService:
    return container.reimbursement


ReimbursementDep = Annotated[ReimbursementService, Depends(get_reimbursement_service)]


# The URL key of each showcase workflow -> the AutomationEdge client method that runs it.
_WORKFLOWS = {
    "read-bill": "read_bill",
    "check-policy": "check_reimbursement_policy",
    "submit-claim": "submit_expense_claim",
    "create-claim": "create_claim_orangehrm",
}


class ClearResponse(CamelModel):
    removed: int


@router.get("/lookup", response_model=EmployeeSummary)
def lookup(service: ReimbursementDep, ref: Ref):
    """Recognise an onboarded employee by Employee ID or e-mail (404 if unknown)."""
    return service.lookup(ref)


@router.post("/bills/read", response_model=ExpenseItem)
async def read_bill(request: Request, service: ReimbursementDep, settings: SettingsDep):
    """``multipart/form-data``: ``ref`` (employee ID or e-mail) and ``file`` (a PDF or a photo of one bill).

    Returns what is on the bill (category, date, amount, vendor); nothing is saved. Without ``OPENAI_API_KEY`` this answers 502.
    """
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile) or not upload.filename:
        raise ValidationFailedError("Attach the bill to read.")
    content = await upload.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise ValidationFailedError("The file is too large.")
    return service.read_bill(str(form.get("ref", "")), upload.filename, content, upload.content_type)


@router.get("/claims", response_model=list[ReimbursementClaim])
def list_claims(service: ReimbursementDep):
    return service.list_claims()


@router.post("/claims", response_model=ReimbursementClaim, status_code=status.HTTP_201_CREATED)
def submit_claim(data: ClaimSubmission, service: ReimbursementDep):
    """Send the claim, with bills of any kind, to the manager."""
    return service.submit(data)


@router.delete("/claims", response_model=ClearResponse)
def clear_claims(service: ReimbursementDep):
    """Delete decided claims from the portal. What was recorded in OrangeHRM stays there."""
    return ClearResponse(removed=service.clear())


@router.get("/claims/{claim_id}", response_model=ReimbursementClaim)
def get_claim(claim_id: str, service: ReimbursementDep):
    return service.get_claim(claim_id)


@router.post("/claims/{claim_id}/approve", response_model=ReimbursementClaim)
def approve(claim_id: str, service: ReimbursementDep, decision: ClaimDecision | None = None):
    """Approve the chosen bills (``approvedBills``: their 0-based positions; no body: all of them) and reject the rest."""
    return service.approve(claim_id, decision.approved_bills if decision else None)


@router.post("/claims/{claim_id}/reject", response_model=ReimbursementClaim)
def reject(claim_id: str, service: ReimbursementDep):
    """Reject the whole claim."""
    return service.reject(claim_id)


@router.post("/claims/{claim_id}/apply", response_model=ReimbursementClaim)
def apply(claim_id: str, service: ReimbursementDep):
    """Record an approved claim in OrangeHRM (Claim module). Repeating it does nothing."""
    return service.apply(claim_id)


@router.post("/workflows/{key}", response_model=LeaveWorkflowRun)
def run_workflow(key: str, container: ContainerDep):
    """Run one of the AutomationEdge showcase workflows and wait until it finishes (the portal's own calls do the real work)."""
    return run_showcase_workflow(container, _WORKFLOWS, key)

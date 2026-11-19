"""Pre-onboarding endpoints, in the order of the lifecycle: the candidate and the offer letter, the acceptance, the personal details, the seven documents,
the (dummy) background check, HR's approval, the joining instructions and the completion."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile

from app.api.deps import ContainerDep, SettingsDep
from app.core.exceptions import ValidationFailedError
from app.schemas.preonboarding import (
    AcceptRequest,
    CandidateStart,
    ClearResponse,
    DecisionNote,
    DispatchRequest,
    DocumentResult,
    PersonalInfo,
    PreCandidate,
)
from app.services.preonboarding_service import PreOnboardingService

router = APIRouter(prefix="/pre-onboarding", tags=["pre-onboarding"])


def get_service(container: ContainerDep) -> PreOnboardingService:
    return container.preonboarding


ServiceDep = Annotated[PreOnboardingService, Depends(get_service)]


@router.post("/candidates", response_model=PreCandidate, status_code=status.HTTP_201_CREATED)
def start(data: CandidateStart, service: ServiceDep):
    """Register the candidate (the offer is released) and raise the ServiceNow request. A ServiceNow problem is shown on the record (``serviceNow.error``)."""
    return service.create(data)


@router.get("/candidates", response_model=list[PreCandidate])
def list_candidates(service: ServiceDep):
    return service.list_candidates()


@router.delete("/candidates", response_model=ClearResponse)
def clear(service: ServiceDep):
    """Delete finished candidates (rejected or completed) with their files."""
    return ClearResponse(removed=service.clear())


@router.get("/candidates/{candidate_id}", response_model=PreCandidate)
def get_candidate(candidate_id: str, service: ServiceDep):
    return service.get(candidate_id)


@router.post("/candidates/{candidate_id}/documents", response_model=DocumentResult)
async def upload_document(candidate_id: str, request: Request, service: ServiceDep, settings: SettingsDep):
    """``multipart/form-data``: ``key`` (tenth, twelfth, degree, aadhaar, pan, photo or resume) and ``file``.

    The document is read with Gemini. ``accepted`` says whether it passed and was kept; ``document.check`` says what was found.
    """
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile) or not upload.filename:
        raise ValidationFailedError("Attach the document.")
    content = await upload.read(settings.max_upload_bytes + 1)
    return service.upload_document(candidate_id, str(form.get("key", "")), upload.filename, content, upload.content_type)


@router.get("/candidates/{candidate_id}/documents/{key}/download")
def download_document(candidate_id: str, key: str, service: ServiceDep):
    path, document = service.document_path(candidate_id, key)
    return FileResponse(path, media_type=document.content_type, filename=document.file_name, content_disposition_type="inline")


@router.post("/candidates/{candidate_id}/verify", response_model=PreCandidate)
def verify(candidate_id: str, service: ServiceDep):
    """Cross-check the name on all seven documents (409 until every document has passed)."""
    return service.verify(candidate_id)


@router.post("/candidates/{candidate_id}/bgv", response_model=PreCandidate)
def background_check(candidate_id: str, service: ServiceDep):
    """Background verification: a dummy that always comes back clear (409 until the documents have passed the name check)."""
    return service.background_check(candidate_id)


@router.post("/candidates/{candidate_id}/hr/approve", response_model=PreCandidate)
def hr_approve(candidate_id: str, service: ServiceDep, body: DecisionNote | None = None):
    return service.hr_decision(candidate_id, True, body.note if body else None)


@router.post("/candidates/{candidate_id}/hr/reject", response_model=PreCandidate)
def hr_reject(candidate_id: str, service: ServiceDep, body: DecisionNote | None = None):
    return service.hr_decision(candidate_id, False, body.note if body else None)


@router.post("/candidates/{candidate_id}/offer", response_model=PreCandidate)
def make_offer(candidate_id: str, service: ServiceDep):
    """Make the offer letter (a PDF). It is the first step. Repeating it returns the same letter."""
    return service.make_offer(candidate_id)


@router.get("/candidates/{candidate_id}/offer/download")
def download_offer(candidate_id: str, service: ServiceDep):
    path, name = service.offer_path(candidate_id)
    return FileResponse(path, media_type="application/pdf", filename=name, content_disposition_type="attachment")


@router.post("/candidates/{candidate_id}/dispatch", response_model=PreCandidate)
def dispatch(candidate_id: str, service: ServiceDep, body: DispatchRequest | None = None):
    """E-mail the offer letter to ``to`` (default: the candidate's e-mail). Repeating it does not send it twice."""
    return service.dispatch(candidate_id, body.to if body else None)


@router.post("/candidates/{candidate_id}/accept", response_model=PreCandidate)
def accept(candidate_id: str, service: ServiceDep, body: AcceptRequest | None = None):
    """The candidate accepts the offer and confirms the date of joining (left out = the date in the offer). 409 until the offer has been e-mailed."""
    return service.accept(candidate_id, body.joining_date if body else None)


@router.post("/candidates/{candidate_id}/personal", response_model=PreCandidate)
def personal(candidate_id: str, data: PersonalInfo, service: ServiceDep):
    """The candidate's personal details. Only after the offer is accepted; the document step opens after it."""
    return service.save_personal(candidate_id, data)


@router.post("/candidates/{candidate_id}/joining", response_model=PreCandidate)
def send_joining(candidate_id: str, service: ServiceDep, body: DispatchRequest | None = None):
    """Make the joining-instructions PDF and e-mail it to ``to`` (default: the candidate's e-mail). Only after HR approves. Repeating it does not send it twice."""
    return service.send_joining(candidate_id, body.to if body else None)


@router.get("/candidates/{candidate_id}/joining/download")
def download_joining(candidate_id: str, service: ServiceDep):
    path, name = service.joining_path(candidate_id)
    return FileResponse(path, media_type="application/pdf", filename=name, content_disposition_type="attachment")


@router.post("/candidates/{candidate_id}/complete", response_model=PreCandidate)
def complete(candidate_id: str, service: ServiceDep):
    """Pre-onboarding is completed and the ServiceNow request is closed (only after the joining instructions went out)."""
    return service.complete(candidate_id)

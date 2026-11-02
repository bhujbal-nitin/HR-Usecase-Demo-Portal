"""Candidate onboarding endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from app.api.deps import OnboardingDep, SettingsDep
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.schemas.common import CamelModel
from app.schemas.employee import DOCUMENT_KEYS, CandidateCreate, ClearScope, Employee

router = APIRouter(prefix="/employees", tags=["employees"])

# Multipart envelope overhead allowed on top of the three documents (text fields + signature).
_FORM_OVERHEAD_BYTES = 2 * 1024 * 1024


class ClearResponse(CamelModel):
    removed: int


async def _read_upload(upload: UploadFile, limit: int) -> tuple[str, bytes]:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ValidationFailedError(f"'{upload.filename}' exceeds the {limit // (1024 * 1024)} MB upload limit.")
    return upload.filename or "", data


@router.get("", response_model=list[Employee])
def list_employees(service: OnboardingDep):
    return service.list_employees()


@router.post("", response_model=Employee, status_code=status.HTTP_201_CREATED)
async def submit_candidate(request: Request, service: OnboardingDep, settings: SettingsDep):
    """Register a candidate (``multipart/form-data``).

    Text fields use the camelCase names of ``CandidateCreate`` (fullName, email, phone, dob, aadhaar, uan,
    emergencyName, emergencyPhone, address, department, jobTitle, manager, startDate, annualCtc, hardware,
    workLocation) plus an optional ``signature`` (PNG data URL). Files: ``idDoc``, ``panDoc``, ``uanDoc``, ``salaryDoc`` (PDF/Word).
    """
    declared = int(request.headers.get("content-length") or 0)
    if declared > settings.max_upload_bytes * len(DOCUMENT_KEYS) + _FORM_OVERHEAD_BYTES:
        raise ValidationFailedError("The upload is too large.")

    form = await request.form()
    text_fields = {key: value for key, value in form.items() if isinstance(value, str)}
    try:
        data = CandidateCreate.model_validate(text_fields)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc

    signature = text_fields.get("signature", "")
    files = {}
    for key in DOCUMENT_KEYS:
        upload = form.get(key)
        if isinstance(upload, UploadFile) and upload.filename:
            files[key] = await _read_upload(upload, settings.max_upload_bytes)
    return service.submit(data, files, signature)


@router.post("/sync-servicenow", response_model=list[Employee])
def sync_servicenow(service: OnboardingDep):
    """Start provisioning for requests that were approved directly inside ServiceNow."""
    return service.sync_servicenow_approvals()


@router.delete("", response_model=ClearResponse)
def clear_employees(service: OnboardingDep, scope: Annotated[ClearScope, Query()] = ClearScope.PROCESSED):
    """Delete finished records (``processed``) or everything that is not in flight (``all``)."""
    return ClearResponse(removed=service.clear(scope))


@router.get("/{employee_id}", response_model=Employee)
def get_employee(employee_id: str, service: OnboardingDep):
    return service.get_employee(employee_id)


@router.post("/{employee_id}/approve", response_model=Employee, status_code=status.HTTP_202_ACCEPTED)
def approve_candidate(employee_id: str, service: OnboardingDep):
    """Accept the candidate and run the provisioning pipeline in the background.

    Poll ``GET /employees/{id}`` - ``pipeline`` shows live per-step progress.
    """
    return service.start_approval(employee_id)


@router.post("/{employee_id}/retry-intake", response_model=Employee, status_code=status.HTTP_202_ACCEPTED)
def retry_intake(employee_id: str, service: OnboardingDep):
    """Re-run a failed intake chain (ServiceNow request, candidate-details workflow). Succeeded steps are kept."""
    return service.retry_intake(employee_id)


@router.post("/{employee_id}/retry-provisioning", response_model=Employee, status_code=status.HTTP_202_ACCEPTED)
def retry_provisioning(employee_id: str, service: OnboardingDep):
    """Re-run provisioning from the failed step. Steps that already succeeded are not repeated."""
    return service.retry_provisioning(employee_id)


@router.post("/{employee_id}/skip-intake-step", response_model=Employee, status_code=status.HTTP_202_ACCEPTED)
def skip_intake_step(employee_id: str, service: OnboardingDep):
    """Skip the failed intake step and continue with the next one."""
    return service.skip_intake_step(employee_id)


@router.post("/{employee_id}/skip-provisioning-step", response_model=Employee, status_code=status.HTTP_202_ACCEPTED)
def skip_provisioning_step(employee_id: str, service: OnboardingDep):
    """Skip the failed provisioning step and continue with the next one."""
    return service.skip_provisioning_step(employee_id)


@router.post("/{employee_id}/reject", response_model=Employee)
def reject_candidate(employee_id: str, service: OnboardingDep):
    return service.reject(employee_id)


@router.get("/{employee_id}/documents/{key}")
def download_document(employee_id: str, key: str, service: OnboardingDep):
    if key not in DOCUMENT_KEYS:
        raise NotFoundError("Unknown document type.")
    path, document = service.get_document(employee_id, key)
    return FileResponse(path, media_type=document.content_type, filename=document.filename)


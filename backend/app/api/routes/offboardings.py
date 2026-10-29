"""Employee offboarding endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import FileResponse

from app.api.deps import ContainerDep, SettingsDep
from app.schemas.common import CamelModel
from app.schemas.offboarding import RESIGNATION_REASONS, EmployeeSummary, Offboarding, ResignationCreate
from app.services.offboarding_service import OffboardingService

router = APIRouter(prefix="/offboardings", tags=["offboardings"])


def get_offboarding_service(container: ContainerDep) -> OffboardingService:
    return container.offboarding


OffboardingDep = Annotated[OffboardingService, Depends(get_offboarding_service)]


class OffboardingOptions(CamelModel):
    reasons: list[str]
    notice_period_days: int


class ClearResponse(CamelModel):
    removed: int


@router.get("", response_model=list[Offboarding])
def list_offboardings(service: OffboardingDep):
    return service.list_offboardings()


@router.get("/options", response_model=OffboardingOptions)
def options(settings: SettingsDep):
    """What the chat form offers: the reasons for leaving and the notice period."""
    return OffboardingOptions(reasons=list(RESIGNATION_REASONS), notice_period_days=settings.offboarding_notice_period_days)


@router.get("/lookup", response_model=EmployeeSummary)
def lookup(service: OffboardingDep, ref: Annotated[str, Query(min_length=3, max_length=120)]):
    """Recognise an onboarded employee by Employee ID or e-mail (404 if unknown, 409 if already offboarding)."""
    return service.lookup(ref)


@router.post("", response_model=Offboarding, status_code=status.HTTP_201_CREATED)
def submit_resignation(data: ResignationCreate, service: OffboardingDep):
    """Register a resignation and raise its ServiceNow ticket in the background. HR then approves it."""
    return service.submit(data)


@router.delete("", response_model=ClearResponse)
def clear_offboardings(service: OffboardingDep):
    """Delete finished offboardings (completed or rejected), so the same employee can be offboarded again in a demo."""
    return ClearResponse(removed=service.clear())


@router.get("/{offboarding_id}", response_model=Offboarding)
def get_offboarding(offboarding_id: str, service: OffboardingDep):
    return service.get_offboarding(offboarding_id)


@router.post("/{offboarding_id}/approve", response_model=Offboarding, status_code=status.HTTP_202_ACCEPTED)
def approve(offboarding_id: str, service: OffboardingDep):
    """Accept the resignation and run the offboarding chain in the background (poll ``GET /offboardings/{id}``)."""
    return service.approve(offboarding_id)


@router.post("/{offboarding_id}/reject", response_model=Offboarding)
def reject(offboarding_id: str, service: OffboardingDep):
    return service.reject(offboarding_id)


@router.post("/{offboarding_id}/retry-intake", response_model=Offboarding, status_code=status.HTTP_202_ACCEPTED)
def retry_intake(offboarding_id: str, service: OffboardingDep):
    return service.retry_intake(offboarding_id)


@router.post("/{offboarding_id}/skip-intake-step", response_model=Offboarding, status_code=status.HTTP_202_ACCEPTED)
def skip_intake_step(offboarding_id: str, service: OffboardingDep):
    return service.skip_intake_step(offboarding_id)


@router.post("/{offboarding_id}/skip-step", response_model=Offboarding, status_code=status.HTTP_202_ACCEPTED)
def skip_step(offboarding_id: str, service: OffboardingDep):
    """Skip the failed step and continue with the next one."""
    return service.skip_step(offboarding_id)


@router.post("/{offboarding_id}/retry", response_model=Offboarding, status_code=status.HTTP_202_ACCEPTED)
def retry(offboarding_id: str, service: OffboardingDep):
    """Re-run from the failed step. Steps that already succeeded are not repeated."""
    return service.retry(offboarding_id)


@router.get("/{offboarding_id}/relieving-letter")
def relieving_letter(offboarding_id: str, service: OffboardingDep):
    path = service.get_relieving_letter_path(offboarding_id)
    return FileResponse(path, media_type="application/pdf", filename=path.name)

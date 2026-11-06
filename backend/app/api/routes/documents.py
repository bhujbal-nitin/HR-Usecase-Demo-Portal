"""Document verification used by the agent demo's manual live mode."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.datastructures import UploadFile

from app.api.deps import ContainerDep, SettingsDep
from app.core.exceptions import IntegrationNotConfiguredError, ValidationFailedError
from app.schemas.common import CamelModel
from app.services.document_verification_service import DocumentVerificationService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])


class VerificationStatus(CamelModel):
    enabled: bool
    model: str | None = None


class CheckOut(CamelModel):
    id: str
    label: str
    passed: bool
    detail: str = ""


class VerificationOut(CamelModel):
    doc_key: str
    passed: bool
    detected_type: str
    holder_name: str | None = None
    date_of_birth: str | None = None
    id_number_masked: str | None = None
    checks: list[CheckOut]


def get_verifier(container: ContainerDep) -> DocumentVerificationService:
    return container.document_verification


VerifierDep = Annotated[DocumentVerificationService, Depends(get_verifier)]


@router.get("/verification", response_model=VerificationStatus)
def verification_status(verifier: VerifierDep):
    """Whether OPENAI_API_KEY is set, i.e. whether uploaded documents will be read and checked."""
    return VerificationStatus(enabled=verifier.enabled, model=verifier.model if verifier.enabled else None)


class WorkflowOut(CamelModel):
    workflow_name: str
    status: str
    ok: bool
    skipped: bool = False
    automation_request_id: int | None = None
    agent: str | None = None
    message: str = ""
    instance_url: str | None = None
    response: dict | None = None


@router.post("/verification-workflow", response_model=WorkflowOut)
def run_verification_workflow(container: ContainerDep, settings: SettingsDep):
    """Run the AutomationEdge "HR Demo Document Verification" workflow and wait until it finishes.

    ``ok`` is true only when the instance reaches *Complete*. Without AutomationEdge credentials nothing is run
    (``skipped``), the same way the provisioning steps behave.
    """
    name = settings.ae_workflow_document_verification
    client = container.automationedge
    if not client.is_configured():
        return WorkflowOut(workflow_name=name, status="Skipped", ok=False, skipped=True, message="AutomationEdge is not configured.")
    result = client.verify_documents()
    return WorkflowOut(
        workflow_name=result.workflow_name, status=result.execution_status, ok=result.ok, automation_request_id=result.automation_request_id,
        agent=result.agent_name or None, message=result.message, instance_url=result.instance_url, response=result.response,
    )


@router.post("/verify", response_model=VerificationOut)
async def verify_document(request: Request, verifier: VerifierDep, settings: SettingsDep, container: ContainerDep):
    """``multipart/form-data``: ``docKey`` (idDoc | panDoc | salaryDoc), ``file``, ``fullName`` (from the joining form)
    and, for the PAN card, ``referenceDob`` (YYYY-MM-DD read from the Aadhaar card). With ``employeeId`` (a candidate whose
    ServiceNow request is already open) the outcome is also left as a work note on that request."""
    if not verifier.enabled:
        raise IntegrationNotConfiguredError("Document scanning")
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile) or not upload.filename:
        raise ValidationFailedError("Attach the document to check.")
    content = await upload.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise ValidationFailedError("The file is too large.")
    result = verifier.verify(
        str(form.get("docKey", "")),
        upload.filename,
        content,
        upload.content_type,
        str(form.get("fullName", "")),
        str(form.get("referenceDob", "")) or None,
    )
    employee_id = str(form.get("employeeId", "")).strip()
    if employee_id:
        findings = [c.detail or c.label for c in result.checks if not c.passed] or [c.label for c in result.checks]
        try:
            container.onboarding.note_document_check(employee_id, result.doc_key, result.passed, findings)
        except Exception:  # noqa: BLE001 - the note is a courtesy; the check result is what the caller needs
            logger.warning("Could not note the document check on the ServiceNow request", exc_info=True)
    return VerificationOut(
        doc_key=result.doc_key,
        passed=result.passed,
        detected_type=result.detected_type,
        holder_name=result.holder_name,
        date_of_birth=result.date_of_birth,
        id_number_masked=result.id_number_masked,
        checks=[CheckOut(id=c.id, label=c.label, passed=c.passed, detail=c.detail) for c in result.checks],
    )

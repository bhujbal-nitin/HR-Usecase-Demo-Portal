"""Use-cases for the onboarding flow: submit, review, approve, reject, sync."""

import logging
import secrets
from datetime import datetime
from pathlib import Path

from app.core.exceptions import (
    ConflictError,
    IntegrationError,
    NotFoundError,
    ValidationFailedError,
)
from app.repositories.employee_repository import EmployeeRepository
from app.integrations.servicenow import Attachment
from app.schemas.employee import (
    DOCUMENT_KEYS,
    DOCUMENT_LABELS,
    REQUIRED_DOCUMENT_KEYS,
    CandidateCreate,
    ClearScope,
    Employee,
    EmployeeStatus,
    IntakeStatus,
    ProvisioningStatus,
    StepStatus,
    StoredDocument,
    mark_skipped_by_user,
    step_is_done,
)
from app.services.pipeline.context import PORTAL_SOURCE, SERVICENOW_SOURCE, Gateways, PipelineContext
from app.services.pipeline.runner import ProvisioningRunner, initial_intake, initial_pipeline
from app.utils.task_queue import TaskQueue

logger = logging.getLogger(__name__)

UploadedFile = tuple[str, bytes]  # (original filename, content)


class OnboardingService:
    def __init__(
        self,
        repository: EmployeeRepository,
        gateways: Gateways,
        runner: ProvisioningRunner,
        task_queue: TaskQueue,
    ):
        self._repo = repository
        self._gw = gateways
        self._runner = runner
        self._tasks = task_queue

    # ----------------------------------------------------------------- reads
    def list_employees(self) -> list[Employee]:
        return self._repo.list_all()

    def get_employee(self, employee_id: str) -> Employee:
        return self._repo.require(employee_id)

    def get_document(self, employee_id: str, key: str) -> tuple[Path, StoredDocument]:
        employee = self._repo.require(employee_id)
        document = employee.documents.get(key)
        if document is None:
            raise NotFoundError("That document was not uploaded for this candidate.")
        return self._gw.documents.path_of(employee_id, document), document

    # ---------------------------------------------------------------- submit
    def submit(self, data: CandidateCreate, files: dict[str, UploadedFile], signature_data_url: str) -> Employee:
        missing = [DOCUMENT_LABELS[k] for k in REQUIRED_DOCUMENT_KEYS if k not in files]
        if missing:
            raise ValidationFailedError(f"Missing required document(s): {', '.join(missing)}.")

        employee_id = self._new_id()
        store = self._gw.documents
        try:
            documents = {key: store.save_document(employee_id, key, *files[key]) for key in files}
            signature = store.save_signature(employee_id, signature_data_url) if (signature_data_url or "").strip() else None
        except Exception:
            store.delete_all(employee_id)
            raise

        employee = Employee(
            id=employee_id, **data.model_dump(), documents=documents, signature_file=signature,
            intake=initial_intake(), intake_status=IntakeStatus.RUNNING,
        )
        self._repo.add(employee)
        self._tasks.enqueue(f"Intake {employee.full_name}", self._run_intake, employee_id, False)
        return employee

    def _run_intake(self, employee_id: str, retry: bool) -> None:
        """ServiceNow request, then the candidate-details workflow - in order, stopping at the first failure.

        A candidate whose documents are still to come (``staged_intake``) only gets the request now; the workflow follows
        once ``finish_documents`` says every required document is in.
        """
        snapshot = self._repo.require(employee_id)
        until = "servicenow_request" if snapshot.staged_intake and not self._has_required_documents(snapshot) else None
        try:
            self._runner.run_intake(PipelineContext(employee=snapshot, gateways=self._gw), retry=retry, until=until)
        except Exception as exc:  # noqa: BLE001 - e.g. disk failure while saving progress
            logger.exception("Intake aborted for %s", employee_id)
            self._abort_intake(employee_id, str(exc))
            raise

    @staticmethod
    def _has_required_documents(employee: Employee) -> bool:
        return all(key in employee.documents for key in REQUIRED_DOCUMENT_KEYS)

    # --------------------------------------------- request first, documents after
    def start(self, data: CandidateCreate) -> Employee:
        """Register a candidate *without documents*: the ServiceNow request is raised now and the documents are attached
        to it as they arrive (``add_document``). The wizard does not use this; it sends everything with ``submit``."""
        employee = Employee(
            id=self._new_id(), **data.model_dump(), staged_intake=True, intake=initial_intake(), intake_status=IntakeStatus.RUNNING,
        )
        self._repo.add(employee)
        self._tasks.enqueue(f"Intake {employee.full_name}", self._run_intake, employee.id, False)
        return employee

    def add_document(self, employee_id: str, key: str, filename: str, data: bytes) -> Employee:
        """Store one document of a candidate who is still sending them and attach it to the ServiceNow request.

        A document sent again (after it failed a check) replaces the stored one; the earlier file stays on the request as
        part of its history and the work note says it was replaced.
        """
        if key not in DOCUMENT_KEYS:
            raise ValidationFailedError("Unknown document type.")
        employee = self._require_collecting(self._repo.require(employee_id))
        stored = self._gw.documents.save_document(employee_id, key, filename, data)
        replaced = key in employee.documents

        warnings: list[str] = []
        names = list(employee.service_now.attached_documents)
        sn = self._gw.servicenow
        if employee.service_now.req_sys_id and sn.is_configured():
            warnings = sn.attach_document(employee, Attachment(stored.filename, data, stored.content_type))
            if stored.filename not in names:
                names.append(stored.filename)
            verb = "replaced by a new upload" if replaced else "received and attached"
            sn.add_request_note(employee, f"{stored.label} {verb} ({stored.filename}).")
            sn.update_request_documents(employee, names)

        def mutate(e: Employee) -> None:
            e.documents[key] = stored
            e.service_now.attached_documents = names
            if warnings:
                e.service_now.sync_error = "; ".join(filter(None, [e.service_now.sync_error, *warnings]))

        return self._repo.update(employee_id, mutate)

    def note_document_check(self, employee_id: str, key: str, passed: bool, findings: list[str]) -> None:
        """Leave the outcome of a document check as a work note on the candidate's request."""
        employee = self._repo.get(employee_id)
        if employee is None or not employee.staged_intake or not employee.service_now.req_sys_id or not self._gw.servicenow.is_configured():
            return
        label = DOCUMENT_LABELS.get(key, key)
        text = f"{label} checked by document scanning: {'passed' if passed else 'did not pass'}."
        if findings:
            text += " " + "; ".join(findings)
        self._gw.servicenow.add_request_note(employee, text)

    def finish_documents(self, employee_id: str) -> Employee:
        """Every required document is in and has passed: run the rest of the intake (the candidate-details workflow)."""

        def mutate(e: Employee) -> None:
            self._require_collecting(e)
            missing = [DOCUMENT_LABELS[k] for k in REQUIRED_DOCUMENT_KEYS if k not in e.documents]
            if missing:
                raise ValidationFailedError(f"Missing required document(s): {', '.join(missing)}.")
            e.intake_status = IntakeStatus.RUNNING

        employee = self._repo.update(employee_id, mutate)
        if employee.service_now.req_sys_id and self._gw.servicenow.is_configured():
            self._gw.servicenow.add_request_note(employee, "All required documents received; running the candidate-details workflow.")
        self._tasks.enqueue(f"Intake {employee.full_name}", self._run_intake, employee_id, True)
        return employee

    @staticmethod
    def _require_collecting(employee: Employee) -> Employee:
        if not employee.staged_intake or employee.status != EmployeeStatus.PENDING_REVIEW or employee.intake_status != IntakeStatus.AWAITING_DOCUMENTS:
            raise ConflictError(f"{employee.full_name} is not waiting for documents.")
        return employee

    def retry_intake(self, employee_id: str) -> Employee:
        """Re-run a failed intake chain. Steps that already succeeded (e.g. the ServiceNow request) are kept."""

        def mutate(e: Employee) -> None:
            if e.status != EmployeeStatus.PENDING_REVIEW or e.intake_status != IntakeStatus.FAILED:
                raise ConflictError("Only a candidate whose intake failed can be retried.")
            e.intake_status = IntakeStatus.RUNNING

        employee = self._repo.update(employee_id, mutate)
        self._tasks.enqueue(f"Retry intake {employee.full_name}", self._run_intake, employee_id, True)
        return employee

    def skip_intake_step(self, employee_id: str) -> Employee:
        """Skip the intake step that failed and carry on with the next one."""

        def mutate(e: Employee) -> None:
            failed = next((s for s in e.intake if s.status == StepStatus.FAILED), None)
            if e.status != EmployeeStatus.PENDING_REVIEW or e.intake_status != IntakeStatus.FAILED or failed is None:
                raise ConflictError("Only a candidate whose intake failed has a step to skip.")
            mark_skipped_by_user(failed)
            for step in e.intake:
                if not step_is_done(step):
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            e.intake_status = IntakeStatus.RUNNING

        employee = self._repo.update(employee_id, mutate)
        self._tasks.enqueue(f"Continue intake {employee.full_name}", self._run_intake, employee_id, True)
        return employee

    def _abort_intake(self, employee_id: str, reason: str) -> None:
        def mutate(e: Employee) -> None:
            for step in e.intake:
                if step.status in (StepStatus.PENDING, StepStatus.RUNNING):
                    step.status, step.message = StepStatus.FAILED, f"Aborted: {reason}"
            e.intake_status = IntakeStatus.FAILED

        try:
            self._repo.update(employee_id, mutate)
        except Exception:  # noqa: BLE001
            logger.exception("Could not record the intake abort for %s", employee_id)

    # -------------------------------------------------------------- approval
    def start_approval(self, employee_id: str, source: str = PORTAL_SOURCE) -> Employee:
        """Move the candidate to 'Processing' (atomically) and provision in the background."""

        def mutate(e: Employee) -> None:
            if e.status != EmployeeStatus.PENDING_REVIEW:
                raise ConflictError(f"{e.full_name} is already {e.status.value.lower()}; nothing to approve.")
            if e.intake_status == IntakeStatus.RUNNING:
                raise ConflictError(f"{e.full_name}: intake is still running. Wait for it to finish before approving.")
            if e.intake_status == IntakeStatus.AWAITING_DOCUMENTS:
                raise ConflictError(f"{e.full_name}: the documents have not all arrived yet.")
            if e.intake_status == IntakeStatus.FAILED:
                raise ConflictError(f"{e.full_name}: intake did not complete successfully. Retry it before approving.")
            e.status = EmployeeStatus.PROCESSING
            e.provisioning_status = ProvisioningStatus.RUNNING
            e.pipeline = initial_pipeline()

        employee = self._repo.update(employee_id, mutate)
        self._tasks.enqueue(f"Provision {employee.full_name}", self._provision, employee_id, source)
        return employee

    def retry_provisioning(self, employee_id: str) -> Employee:
        """Re-run the provisioning chain from the step that failed. Steps that already succeeded are never repeated."""

        def mutate(e: Employee) -> None:
            failed = any(s.status == StepStatus.FAILED for s in e.pipeline)
            if e.status not in (EmployeeStatus.FAILED, EmployeeStatus.APPROVED) or not failed:
                raise ConflictError("Only a candidate with a failed provisioning step can be re-run.")
            for step in e.pipeline:
                if not step_is_done(step):  # the failed step and the "not run" ones start over
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            e.status, e.provisioning_status = EmployeeStatus.PROCESSING, ProvisioningStatus.RUNNING

        employee = self._repo.update(employee_id, mutate)
        self._tasks.enqueue(f"Re-run provisioning {employee.full_name}", self._provision, employee_id, employee.approval_source or PORTAL_SOURCE, True)
        return employee

    def skip_provisioning_step(self, employee_id: str) -> Employee:
        """Skip the provisioning step that failed and carry on with the next one."""

        def mutate(e: Employee) -> None:
            failed = next((s for s in e.pipeline if s.status == StepStatus.FAILED), None)
            if e.status not in (EmployeeStatus.FAILED, EmployeeStatus.APPROVED) or failed is None:
                raise ConflictError("Only a candidate with a failed provisioning step has a step to skip.")
            mark_skipped_by_user(failed)
            for step in e.pipeline:
                if not step_is_done(step):
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            e.status, e.provisioning_status = EmployeeStatus.PROCESSING, ProvisioningStatus.RUNNING

        employee = self._repo.update(employee_id, mutate)
        self._tasks.enqueue(f"Continue provisioning {employee.full_name}", self._provision, employee_id, employee.approval_source or PORTAL_SOURCE, True)
        return employee

    def _provision(self, employee_id: str, source: str, retry: bool = False) -> None:
        snapshot = self._repo.require(employee_id)
        try:
            ctx = PipelineContext(employee=snapshot, gateways=self._gw, source=source)
            if retry:
                ctx.resume_from(snapshot)
            self._runner.run(ctx, retry=retry)
        except Exception as exc:  # noqa: BLE001 - e.g. disk failure while saving progress
            logger.exception("Provisioning aborted for %s", employee_id)
            self._abort(employee_id, str(exc))
            raise

    def _abort(self, employee_id: str, reason: str) -> None:
        def mutate(e: Employee) -> None:
            for step in e.pipeline:
                if step.status in (StepStatus.PENDING, StepStatus.RUNNING):
                    step.status, step.message = StepStatus.FAILED, f"Aborted: {reason}"
            e.status = EmployeeStatus.FAILED
            e.provisioning_status = ProvisioningStatus.FAILED

        try:
            self._repo.update(employee_id, mutate)
        except Exception:  # noqa: BLE001
            logger.exception("Could not record the abort for %s", employee_id)

    def recover_interrupted(self) -> int:
        """On startup, close out candidates whose provisioning was cut short by a restart.

        The queue is in-memory, so a "Processing" record with no worker can never finish. It is marked as
        "Provisioning Failed" (not re-run): steps may already have created real accounts, and blindly
        repeating them could duplicate users or tickets. HR sees which steps finished and which did not.
        An interrupted intake chain is marked failed and can be retried.
        """
        for employee in self._repo.list_all():
            if employee.intake_status == IntakeStatus.RUNNING:
                logger.warning("Intake for %s was interrupted by a restart.", employee.id)
                self._abort_intake(employee.id, "the server restarted while intake was running")
        interrupted = [e for e in self._repo.list_all() if e.status == EmployeeStatus.PROCESSING]
        for employee in interrupted:
            logger.warning("Provisioning for %s was interrupted by a restart.", employee.id)
            self._abort(employee.id, "the server restarted while provisioning was running")
        return len(interrupted)

    def reject(self, employee_id: str) -> Employee:
        employee = self._repo.require(employee_id)
        if employee.status != EmployeeStatus.PENDING_REVIEW:
            raise ConflictError(f"{employee.full_name} is already {employee.status.value.lower()}.")

        sn_error: str | None = None
        if employee.service_now.req_sys_id:
            try:
                self._gw.servicenow.reject_request(employee.service_now.req_sys_id, employee.full_name)
            except IntegrationError as exc:  # the HR decision stands even if ServiceNow is unreachable
                sn_error = exc.message

        def mutate(e: Employee) -> None:
            if e.status != EmployeeStatus.PENDING_REVIEW:
                raise ConflictError(f"{e.full_name} is already {e.status.value.lower()}.")
            e.status = EmployeeStatus.REJECTED
            e.rejected_at = datetime.now()
            e.service_now.approval_status = "Rejected"
            e.service_now.stage = "Closed - Rejected"
            if sn_error:
                e.service_now.sync_error = f"Rejection not propagated to ServiceNow: {sn_error}"

        return self._repo.update(employee_id, mutate)

    # ----------------------------------------------------------- sn polling
    def sync_servicenow_approvals(self) -> list[Employee]:
        """Start provisioning for requests that were approved directly inside ServiceNow."""
        if not self._gw.servicenow.is_configured():
            return []
        started: list[Employee] = []
        for employee in self._repo.list_all():
            sys_id = employee.service_now.req_sys_id
            if employee.status != EmployeeStatus.PENDING_REVIEW or not sys_id:
                continue
            try:
                approval, number = self._gw.servicenow.get_request_approval(sys_id)
            except IntegrationError as exc:
                logger.warning("ServiceNow approval check failed for %s: %s", employee.id, exc)
                continue
            if approval != "approved":
                continue
            logger.info("%s approved inside ServiceNow (%s); starting provisioning", employee.full_name, number)
            try:
                started.append(self.start_approval(employee.id, source=SERVICENOW_SOURCE))
            except ConflictError:
                continue  # approved from the portal in the meantime
        return started

    # ----------------------------------------------------------------- admin
    def clear(self, scope: ClearScope) -> int:
        busy = {EmployeeStatus.PROCESSING}
        keep = busy | ({EmployeeStatus.PENDING_REVIEW} if scope == ClearScope.PROCESSED else set())
        removed = self._repo.delete_where(lambda e: e.status not in keep)
        for employee in removed:
            self._gw.documents.delete_all(employee.id)
        return len(removed)

    # -------------------------------------------------------------- internals
    def _new_id(self) -> str:
        existing = {e.id for e in self._repo.list_all()}
        while True:
            candidate = f"AE-{secrets.randbelow(900_000) + 100_000}"
            if candidate not in existing:
                return candidate

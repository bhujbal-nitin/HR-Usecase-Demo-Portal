"""Use-cases for the offboarding flow: look up the employee, submit the resignation, review, approve, run, retry."""

import logging
import secrets
from datetime import date, datetime
from pathlib import Path

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.offboarding_repository import OffboardingRepository
from app.schemas.employee import Employee, EmployeeStatus, IntakeStatus, PipelineStep, ProvisioningStatus, StepStatus, mark_skipped_by_user, step_is_done
from app.schemas.offboarding import EmployeeSummary, Offboarding, OffboardingStatus, ResignationCreate
from app.services.offboarding.steps import INTAKE_STEPS, OFFBOARDING_STEPS, OffboardingContext, OffboardingGateways, OffboardingStep
from app.services.pipeline.attempts import StepOutcome
from app.utils.task_queue import TaskQueue

logger = logging.getLogger(__name__)

_FINAL = {OffboardingStatus.COMPLETED, OffboardingStatus.REJECTED}


def _initial(steps: list[OffboardingStep]) -> list[PipelineStep]:
    return [PipelineStep(key=s.key, label=s.label, system=s.system) for s in steps]


class OffboardingService:
    def __init__(
        self,
        repository: OffboardingRepository,
        employees: EmployeeRepository,
        gateways: OffboardingGateways,
        task_queue: TaskQueue,
    ):
        self._repo = repository
        self._employees = employees
        self._gw = gateways
        self._tasks = task_queue

    # ----------------------------------------------------------------- reads
    def list_offboardings(self) -> list[Offboarding]:
        return self._repo.list_all()

    def get_offboarding(self, offboarding_id: str) -> Offboarding:
        return self._repo.require(offboarding_id)

    def get_relieving_letter_path(self, offboarding_id: str) -> Path:
        record = self._repo.require(offboarding_id)
        path = self._gw.letters.path_for(record)
        if not record.relieving_letter or not path.is_file():
            raise NotFoundError("No relieving letter has been generated for this employee yet.")
        return path

    # ---------------------------------------------------------------- lookup
    def _work_email(self, e: Employee) -> str:
        return (e.office365.user_principal_name if e.office365 and e.office365.user_principal_name else None) or (
            e.orange_hrm.work_email if e.orange_hrm and e.orange_hrm.work_email else None
        ) or e.email

    def _find_employee(self, ref: str) -> Employee:
        """An onboarded (approved) employee, found by Employee ID or by personal / work e-mail."""
        wanted = ref.strip().lower()
        if not wanted:
            raise ValidationFailedError("Enter your employee ID or e-mail address.")
        for e in self._employees.list_all():
            handles = {e.id.lower(), e.email.lower(), self._work_email(e).lower()}
            if wanted in handles:
                if e.status != EmployeeStatus.APPROVED:
                    raise ConflictError(f"{e.full_name} has not completed onboarding yet, so there is nothing to offboard.")
                return e
        raise NotFoundError("No employee onboarded through this portal matches that ID or e-mail address.")

    def _active_for(self, employee_id: str) -> Offboarding | None:
        return next((o for o in self._repo.list_all() if o.employee_id == employee_id and o.status != OffboardingStatus.REJECTED), None)

    def lookup(self, ref: str) -> EmployeeSummary:
        employee = self._find_employee(ref)
        existing = self._active_for(employee.id)
        if existing:
            raise ConflictError(f"{employee.full_name} already has an offboarding ({existing.id}, {existing.status.value.lower()}).")
        return EmployeeSummary(
            employee_id=employee.id, full_name=employee.full_name, department=employee.department,
            job_title=employee.job_title, manager=employee.manager, work_email=self._work_email(employee),
        )

    # ---------------------------------------------------------------- submit
    def submit(self, data: ResignationCreate) -> Offboarding:
        employee = self._find_employee(data.employee_ref)
        if self._active_for(employee.id):
            raise ConflictError(f"{employee.full_name} already has an offboarding in progress or completed.")
        today = date.today()
        if data.last_working_day < today:
            raise ValidationFailedError("The last working day cannot be in the past.")

        record = Offboarding(
            id=self._new_id(),
            employee_id=employee.id,
            full_name=employee.full_name,
            work_email=self._work_email(employee),
            personal_email=employee.email,
            department=employee.department,
            job_title=employee.job_title,
            manager=employee.manager,
            hardware=employee.laptop.hardware if employee.laptop and employee.laptop.hardware else employee.hardware,
            annual_ctc=employee.annual_ctc,
            emp_number=employee.orange_hrm.emp_number if employee.orange_hrm else None,
            user_principal_name=employee.office365.user_principal_name if employee.office365 else None,
            reason=data.reason,
            comments=data.comments,
            resignation_date=today,
            last_working_day=data.last_working_day,
            notice_period_days=self._gw.settings.offboarding_notice_period_days,
            leave_balance_days=data.leave_balance_days,
            intake=_initial(INTAKE_STEPS),
            intake_status=IntakeStatus.RUNNING,
        )
        self._repo.add(record)
        self._tasks.enqueue(f"Offboarding intake {record.full_name}", self._run_intake, record.id, False)
        return record

    def _run_intake(self, offboarding_id: str, retry: bool) -> None:
        try:
            self._repo.update(offboarding_id, lambda o: setattr(o, "intake_status", IntakeStatus.RUNNING))
            failed = self._execute(offboarding_id, INTAKE_STEPS, "intake", keep_successful=retry)
            self._repo.update(
                offboarding_id, lambda o: setattr(o, "intake_status", IntakeStatus.FAILED if failed is not None else IntakeStatus.COMPLETED)
            )
        except Exception as exc:  # noqa: BLE001 - e.g. disk failure while saving progress
            logger.exception("Offboarding intake aborted for %s", offboarding_id)
            self._abort(offboarding_id, "intake", str(exc))
            raise

    def retry_intake(self, offboarding_id: str) -> Offboarding:
        def mutate(o: Offboarding) -> None:
            if o.status != OffboardingStatus.PENDING_REVIEW or o.intake_status != IntakeStatus.FAILED:
                raise ConflictError("Only an offboarding whose intake failed can be retried.")
            o.intake_status = IntakeStatus.RUNNING

        record = self._repo.update(offboarding_id, mutate)
        self._tasks.enqueue(f"Retry offboarding intake {record.full_name}", self._run_intake, offboarding_id, True)
        return record

    # -------------------------------------------------------------- approval
    def approve(self, offboarding_id: str) -> Offboarding:
        """Move to 'Processing' (atomically) and run the offboarding chain in the background."""

        def mutate(o: Offboarding) -> None:
            if o.status != OffboardingStatus.PENDING_REVIEW:
                raise ConflictError(f"{o.full_name}'s offboarding is already {o.status.value.lower()}; nothing to approve.")
            if o.intake_status == IntakeStatus.RUNNING:
                raise ConflictError(f"{o.full_name}: the ticket is still being created. Wait for it to finish before approving.")
            if o.intake_status == IntakeStatus.FAILED:
                raise ConflictError(f"{o.full_name}: the ServiceNow ticket was not created. Retry it before approving.")
            o.status, o.pipeline_status = OffboardingStatus.PROCESSING, ProvisioningStatus.RUNNING
            o.pipeline = _initial(OFFBOARDING_STEPS)
            o.approved_at = datetime.now()

        record = self._repo.update(offboarding_id, mutate)
        self._tasks.enqueue(f"Offboard {record.full_name}", self._run_chain, offboarding_id, False)
        return record

    def retry(self, offboarding_id: str) -> Offboarding:
        """Re-run the chain from the step that failed. Steps that already succeeded are never repeated."""

        def mutate(o: Offboarding) -> None:
            if o.status != OffboardingStatus.FAILED or not any(s.status == StepStatus.FAILED for s in o.pipeline):
                raise ConflictError("Only an offboarding with a failed step can be re-run.")
            for step in o.pipeline:
                if not step_is_done(step):
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            o.status, o.pipeline_status = OffboardingStatus.PROCESSING, ProvisioningStatus.RUNNING

        record = self._repo.update(offboarding_id, mutate)
        self._tasks.enqueue(f"Re-run offboarding {record.full_name}", self._run_chain, offboarding_id, True)
        return record

    def skip_intake_step(self, offboarding_id: str) -> Offboarding:
        def mutate(o: Offboarding) -> None:
            failed = next((s for s in o.intake if s.status == StepStatus.FAILED), None)
            if o.status != OffboardingStatus.PENDING_REVIEW or o.intake_status != IntakeStatus.FAILED or failed is None:
                raise ConflictError("Only an offboarding whose intake failed has a step to skip.")
            mark_skipped_by_user(failed)
            for step in o.intake:
                if not step_is_done(step):
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            o.intake_status = IntakeStatus.RUNNING

        record = self._repo.update(offboarding_id, mutate)
        self._tasks.enqueue(f"Continue offboarding intake {record.full_name}", self._run_intake, offboarding_id, True)
        return record

    def skip_step(self, offboarding_id: str) -> Offboarding:
        """Skip the step that failed and carry on with the next one."""

        def mutate(o: Offboarding) -> None:
            failed = next((s for s in o.pipeline if s.status == StepStatus.FAILED), None)
            if o.status != OffboardingStatus.FAILED or failed is None:
                raise ConflictError("Only an offboarding with a failed step has a step to skip.")
            mark_skipped_by_user(failed)
            for step in o.pipeline:
                if not step_is_done(step):
                    step.status, step.message, step.details = StepStatus.PENDING, None, {}
                    step.started_at = step.finished_at = None
            o.status, o.pipeline_status = OffboardingStatus.PROCESSING, ProvisioningStatus.RUNNING

        record = self._repo.update(offboarding_id, mutate)
        self._tasks.enqueue(f"Continue offboarding {record.full_name}", self._run_chain, offboarding_id, True)
        return record

    def reject(self, offboarding_id: str) -> Offboarding:
        record = self._repo.require(offboarding_id)
        if record.status != OffboardingStatus.PENDING_REVIEW:
            raise ConflictError(f"{record.full_name}'s offboarding is already {record.status.value.lower()}.")

        ticket = next((s.details for s in record.intake if s.key == "servicenow_ticket" and s.status == StepStatus.SUCCESS), {})
        note: str | None = None
        if ticket.get("sysId"):
            try:
                self._gw.servicenow.resolve_incident(ticket["sysId"], "Resignation not accepted by HR from the HR Demo Portal.")
            except Exception as exc:  # noqa: BLE001 - the HR decision stands even if ServiceNow is unreachable
                note = f"Ticket not closed: {getattr(exc, 'message', exc)}"

        def mutate(o: Offboarding) -> None:
            if o.status != OffboardingStatus.PENDING_REVIEW:
                raise ConflictError(f"{o.full_name}'s offboarding is already {o.status.value.lower()}.")
            o.status, o.rejected_at = OffboardingStatus.REJECTED, datetime.now()
            if note:
                o.comments = f"{o.comments}\n{note}".strip()

        return self._repo.update(offboarding_id, mutate)

    # ----------------------------------------------------------------- chain
    def _run_chain(self, offboarding_id: str, retry: bool) -> None:
        try:
            failed = self._execute(offboarding_id, OFFBOARDING_STEPS, "pipeline", keep_successful=retry)

            def finish(o: Offboarding) -> None:
                if failed is None:
                    o.status, o.pipeline_status, o.completed_at = OffboardingStatus.COMPLETED, ProvisioningStatus.COMPLETED, datetime.now()
                    letter = next((s.details for s in o.pipeline if s.key == "relieving_letter" and s.status == StepStatus.SUCCESS), None)
                    o.relieving_letter = letter or o.relieving_letter
                else:
                    o.status, o.pipeline_status = OffboardingStatus.FAILED, ProvisioningStatus.FAILED

            self._repo.update(offboarding_id, finish)
        except Exception as exc:  # noqa: BLE001 - e.g. disk failure while saving progress
            logger.exception("Offboarding aborted for %s", offboarding_id)
            self._abort(offboarding_id, "pipeline", str(exc))
            raise

    def _execute(self, offboarding_id: str, steps: list[OffboardingStep], field: str, *, keep_successful: bool) -> int | None:
        """Run ``steps`` in order, persisting after each. Returns the index of the step that failed (and stopped the chain)."""
        record = self._repo.require(offboarding_id)
        ctx = OffboardingContext(record=record, gateways=self._gw)
        for chain in ("intake", "pipeline"):  # what earlier successful steps produced (ticket id, settlement figures)
            for step in getattr(record, chain):
                if step.status == StepStatus.SUCCESS:
                    ctx.results[step.key] = step.details

        for index, step in enumerate(steps):
            if keep_successful and self._is_done(offboarding_id, field, step.key):
                continue
            self._mark(offboarding_id, field, step.key, status=StepStatus.RUNNING, started_at=datetime.now(), finished_at=None, message=None)
            try:
                outcome = step.run(ctx)
            except Exception as exc:  # noqa: BLE001 - never leave the record stuck in "running"
                logger.exception("Offboarding step %s crashed", step.key)
                outcome = StepOutcome(StepStatus.FAILED, f"Unexpected error: {exc}")
            logger.info("Offboarding step %s -> %s: %s", step.key, outcome.status.value, outcome.message)
            if outcome.status == StepStatus.SUCCESS:
                ctx.results[step.key] = outcome.details
            self._mark(
                offboarding_id, field, step.key, status=outcome.status, message=outcome.message, details=outcome.details,
                finished_at=datetime.now(),
            )
            if outcome.status == StepStatus.FAILED:
                for later in steps[index + 1:]:
                    if not (keep_successful and self._is_done(offboarding_id, field, later.key)):
                        self._mark(
                            offboarding_id, field, later.key, status=StepStatus.SKIPPED,
                            message=f"Not run: \"{step.label}\" did not succeed.", finished_at=datetime.now(),
                        )
                return index
        return None

    def _is_done(self, offboarding_id: str, field: str, key: str) -> bool:
        record = self._repo.get(offboarding_id)
        return bool(record) and any(step_is_done(s) for s in getattr(record, field) if s.key == key)

    def _status_of(self, offboarding_id: str, field: str, key: str) -> StepStatus | None:
        record = self._repo.get(offboarding_id)
        return next((s.status for s in getattr(record, field) if s.key == key), None) if record else None

    def _mark(self, offboarding_id: str, field: str, key: str, **fields) -> None:
        def mutate(o: Offboarding) -> None:
            for step in getattr(o, field):
                if step.key == key:
                    for name, value in fields.items():
                        setattr(step, name, value)

        self._repo.update(offboarding_id, mutate)

    def _abort(self, offboarding_id: str, field: str, reason: str) -> None:
        def mutate(o: Offboarding) -> None:
            for step in getattr(o, field):
                if step.status in (StepStatus.PENDING, StepStatus.RUNNING):
                    step.status, step.message = StepStatus.FAILED, f"Aborted: {reason}"
            if field == "intake":
                o.intake_status = IntakeStatus.FAILED
            else:
                o.status, o.pipeline_status = OffboardingStatus.FAILED, ProvisioningStatus.FAILED

        try:
            self._repo.update(offboarding_id, mutate)
        except Exception:  # noqa: BLE001
            logger.exception("Could not record the abort for %s", offboarding_id)

    def recover_interrupted(self) -> int:
        """On startup, close out runs that a restart cut short. They are marked failed (not re-run): steps may already
        have changed real systems, and repeating them blindly could duplicate tickets. A person can re-run from the failed step."""
        count = 0
        for record in self._repo.list_all():
            if record.intake_status == IntakeStatus.RUNNING:
                self._abort(record.id, "intake", "the server restarted while the ticket was being created")
            if record.status == OffboardingStatus.PROCESSING:
                count += 1
                self._abort(record.id, "pipeline", "the server restarted while offboarding was running")
        return count

    # ----------------------------------------------------------------- admin
    def clear(self) -> int:
        """Delete finished offboardings (completed or rejected). Their relieving letters stay on disk."""
        return len(self._repo.delete_where(lambda o: o.status in _FINAL))

    def _new_id(self) -> str:
        existing = {o.id for o in self._repo.list_all()}
        while True:
            candidate = f"OFF-{secrets.randbelow(900_000) + 100_000}"
            if candidate not in existing:
                return candidate

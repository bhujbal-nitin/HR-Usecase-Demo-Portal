"""Executes a chain of steps one at a time and persists progress after each one.

Used for both chains: the *intake* chain (after submit) and the *provisioning* chain (after approval).
A step only starts once the previous one has finished; the chain stops at the first real failure, and the
steps after it are recorded as skipped ("not run"). A step whose system has no credentials is skipped and the
chain carries on.
"""

import logging
from datetime import datetime

from app.repositories.employee_repository import EmployeeRepository
from app.schemas.employee import (
    Employee,
    EmployeeStatus,
    IntakeStatus,
    PipelineStep,
    ProvisioningStatus,
    StepStatus,
    step_is_done,
)
from app.services.pipeline.attempts import StepOutcome
from app.services.pipeline.context import PipelineContext
from app.services.pipeline.intake_steps import INTAKE_STEPS
from app.services.pipeline.steps import PROVISIONING_STEPS, Step

logger = logging.getLogger(__name__)


def initial_pipeline(steps: list[Step] = PROVISIONING_STEPS) -> list[PipelineStep]:
    return [PipelineStep(key=s.key, label=s.label, system=s.system) for s in steps]


def initial_intake() -> list[PipelineStep]:
    return initial_pipeline(INTAKE_STEPS)


class ProvisioningRunner:
    def __init__(
        self,
        repository: EmployeeRepository,
        steps: list[Step] | None = None,
        intake_steps: list[Step] | None = None,
    ):
        self._repo = repository
        self._steps = steps or PROVISIONING_STEPS
        self._intake_steps = intake_steps or INTAKE_STEPS

    # ---------------------------------------------------------------- intake
    def run_intake(self, ctx: PipelineContext, *, retry: bool = False) -> Employee:
        """ServiceNow request, then the candidate-details workflow. ``retry`` keeps steps that already succeeded."""
        employee_id = ctx.employee.id
        logger.info("Intake started for %s (%s)", ctx.employee.full_name, employee_id)
        self._repo.update(employee_id, lambda e: setattr(e, "intake_status", IntakeStatus.RUNNING))
        failed_at = self._execute(ctx, self._intake_steps, "intake", keep_successful=retry)

        def finish(employee: Employee) -> None:
            ctx.apply_to(employee)
            employee.intake_status = IntakeStatus.FAILED if failed_at is not None else IntakeStatus.COMPLETED

        return self._repo.update(employee_id, finish)

    # ---------------------------------------------------------- provisioning
    def run(self, ctx: PipelineContext, *, retry: bool = False) -> Employee:
        """Run the provisioning chain. ``retry`` keeps steps that already succeeded and re-runs from the failed one."""
        employee_id = ctx.employee.id
        logger.info("Provisioning %s for %s (%s) via %s", "retry" if retry else "started", ctx.employee.full_name, employee_id, ctx.source)
        failed_at = self._execute(ctx, self._steps, "pipeline", keep_successful=retry)
        last = len(self._steps) - 1

        def finish(employee: Employee) -> None:
            ctx.apply_to(employee)
            employee.approval_source = ctx.source
            if failed_at is None:
                employee.status, employee.provisioning_status = EmployeeStatus.APPROVED, ProvisioningStatus.COMPLETED
                employee.approved_at = datetime.now()
            elif failed_at == last:
                # Everything before the final step worked, so the person is onboarded; only the last step needs attention.
                employee.status, employee.provisioning_status = EmployeeStatus.APPROVED, ProvisioningStatus.COMPLETED_WITH_ERRORS
                employee.approved_at = datetime.now()
            else:
                employee.status, employee.provisioning_status = EmployeeStatus.FAILED, ProvisioningStatus.FAILED

        return self._repo.update(employee_id, finish)

    # -------------------------------------------------------------- internals
    def _execute(self, ctx: PipelineContext, steps: list[Step], field: str, *, keep_successful: bool = False) -> int | None:
        """Run ``steps`` in order. Returns the index of the step that failed (and stopped the chain), else None."""
        employee_id = ctx.employee.id
        for index, step in enumerate(steps):
            if keep_successful and self._is_done(employee_id, field, step.key):
                continue
            self._mark(employee_id, field, step.key, status=StepStatus.RUNNING, started_at=datetime.now(), finished_at=None, message=None)
            try:
                outcome = step.run(ctx)
            except Exception as exc:  # noqa: BLE001 - never leave the record stuck in "running"
                logger.exception("Step %s crashed", step.key)
                outcome = StepOutcome(StepStatus.FAILED, f"Unexpected error: {exc}")
            logger.info("Step %s -> %s: %s", step.key, outcome.status.value, outcome.message)
            self._mark(
                employee_id, field, step.key, status=outcome.status, message=outcome.message,
                details=outcome.details, finished_at=datetime.now(), context=ctx,
            )
            if outcome.status == StepStatus.FAILED:
                for later in steps[index + 1:]:
                    if not (keep_successful and self._is_done(employee_id, field, later.key)):
                        self._mark(
                            employee_id, field, later.key, status=StepStatus.SKIPPED,
                            message=f"Not run: \"{step.label}\" did not succeed.", finished_at=datetime.now(),
                        )
                return index
        return None

    def _is_done(self, employee_id: str, field: str, key: str) -> bool:
        employee = self._repo.get(employee_id)
        return bool(employee) and any(step_is_done(s) for s in getattr(employee, field) if s.key == key)

    def _status_of(self, employee_id: str, field: str, key: str) -> StepStatus | None:
        employee = self._repo.get(employee_id)
        return next((s.status for s in getattr(employee, field) if s.key == key), None) if employee else None

    def _mark(self, employee_id: str, field: str, key: str, *, context: PipelineContext | None = None, **fields) -> None:
        def mutate(employee: Employee) -> None:
            for step in getattr(employee, field):
                if step.key == key:
                    for name, value in fields.items():
                        setattr(step, name, value)
            if context is not None:
                context.apply_to(employee)

        self._repo.update(employee_id, mutate)

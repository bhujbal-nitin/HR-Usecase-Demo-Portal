"""Payroll & salary endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import ContainerDep
from app.api.workflow_runs import run_showcase_workflow
from app.schemas.leave import LeaveWorkflowRun
from app.schemas.offboarding import EmployeeSummary
from app.schemas.payroll import PayrollOptions
from app.services.payroll_service import PayrollService

router = APIRouter(prefix="/payroll", tags=["payroll"])

Ref = Annotated[str, Query(min_length=3, max_length=120, description="Employee ID or e-mail address")]
Month = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="The pay month, YYYY-MM")]
# The URL key of each showcase workflow -> the AutomationEdge client method that runs it.
_WORKFLOWS = {
    "fetch-salary": "fetch_salary_details",
    "generate-payslip": "generate_payslip",
    "generate-ctc": "generate_ctc_statement",
    "generate-form16": "generate_form16",
}
PDF = "application/pdf"


def get_payroll_service(container: ContainerDep) -> PayrollService:
    return container.payroll


PayrollDep = Annotated[PayrollService, Depends(get_payroll_service)]


def _file(filename: str, content: bytes, media_type: str = PDF) -> Response:
    return Response(content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/options", response_model=PayrollOptions)
def options(service: PayrollDep):
    return service.options()


@router.get("/lookup", response_model=EmployeeSummary)
def lookup(service: PayrollDep, ref: Ref):
    """Recognise an onboarded employee by Employee ID or e-mail (404 if unknown)."""
    return service.lookup(ref)


@router.get("/payslip/download")
def payslip(service: PayrollDep, ref: Ref, month: Month):
    """The payslip of one month, as a PDF."""
    return _file(*service.payslip(ref, month))


@router.get("/ctc/download")
def ctc(service: PayrollDep, ref: Ref):
    """The CTC statement as a PDF: the annual CTC split into its components, monthly and yearly."""
    return _file(*service.ctc(ref))


@router.get("/form16/download")
def form16(service: PayrollDep, ref: Ref):
    """Form 16 for the last completed financial year, as a PDF: the employee's full-year salary, deductions and tax."""
    return _file(*service.form16(ref))


@router.post("/workflows/{key}", response_model=LeaveWorkflowRun)
def run_workflow(key: str, container: ContainerDep):
    """Run one of the AutomationEdge showcase workflows and wait until it finishes (the portal's own calls do the real work)."""
    return run_showcase_workflow(container, _WORKFLOWS, key)

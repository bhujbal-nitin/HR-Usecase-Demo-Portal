"""Leave & attendance endpoints."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import ContainerDep
from app.api.workflow_runs import run_showcase_workflow
from app.schemas.common import CamelModel
from app.schemas.leave import (
    AttendanceDayRecords,
    Holiday,
    LeaveApplication,
    LeaveAttendanceRequest,
    LeaveBalance,
    LeaveCheck,
    LeaveCheckRequest,
    LeaveOptions,
    LeaveWorkflowRun,
    RegularizationApplication,
)
from app.schemas.offboarding import EmployeeSummary
from app.services.leave_service import LeaveService

router = APIRouter(prefix="/leave", tags=["leave"])

Ref = Annotated[str, Query(min_length=3, max_length=120, description="Employee ID or e-mail address")]


def get_leave_service(container: ContainerDep) -> LeaveService:
    return container.leave


LeaveDep = Annotated[LeaveService, Depends(get_leave_service)]


# The URL key of each showcase workflow -> the AutomationEdge client method that runs it.
_WORKFLOWS = {
    "balance": "leave_balance",
    "check": "check_leave_request",
    "assign-leave": "assign_leave_orangehrm",
    "attendance": "attendance_records",
    "punch-in": "add_punch_in_orangehrm",
    "punch-out": "punch_out_orangehrm",
}


class ClearResponse(CamelModel):
    removed: int


@router.get("/options", response_model=LeaveOptions)
def options(service: LeaveDep):
    return service.options()


@router.get("/lookup", response_model=EmployeeSummary)
def lookup(service: LeaveDep, ref: Ref):
    """Recognise an onboarded employee by Employee ID or e-mail (404 if unknown)."""
    return service.lookup(ref)


@router.get("/balances", response_model=list[LeaveBalance])
def balances(service: LeaveDep, ref: Ref):
    return service.balances(ref)


@router.get("/holidays", response_model=list[Holiday])
def holidays(service: LeaveDep):
    return service.holidays()


@router.post("/check", response_model=LeaveCheck)
def check_leave(data: LeaveCheckRequest, service: LeaveDep):
    """The balance and policy checks for a leave request, without saving anything."""
    return service.check_leave(data)


@router.get("/attendance", response_model=AttendanceDayRecords)
def attendance(service: LeaveDep, ref: Ref, day: Annotated[date, Query(alias="date", description="The day, YYYY-MM-DD")]):
    """The punch records OrangeHRM holds for one day (an approved attendance request for that day replaces them)."""
    return service.attendance(ref, day)


@router.get("/requests", response_model=list[LeaveAttendanceRequest])
def list_requests(service: LeaveDep):
    return service.list_requests()


@router.post("/requests/leave", response_model=LeaveAttendanceRequest, status_code=status.HTTP_201_CREATED)
def submit_leave(data: LeaveApplication, service: LeaveDep):
    return service.submit_leave(data)


@router.post("/requests/regularization", response_model=LeaveAttendanceRequest, status_code=status.HTTP_201_CREATED)
def submit_regularization(data: RegularizationApplication, service: LeaveDep):
    return service.submit_regularization(data)


@router.delete("/requests", response_model=ClearResponse)
def clear_requests(service: LeaveDep):
    """Delete decided requests from the portal. What was recorded in OrangeHRM stays there."""
    return ClearResponse(removed=service.clear())


@router.get("/requests/{request_id}", response_model=LeaveAttendanceRequest)
def get_request(request_id: str, service: LeaveDep):
    return service.get_request(request_id)


@router.post("/requests/{request_id}/approve", response_model=LeaveAttendanceRequest)
def approve(request_id: str, service: LeaveDep):
    return service.approve(request_id)


@router.post("/requests/{request_id}/reject", response_model=LeaveAttendanceRequest)
def reject(request_id: str, service: LeaveDep):
    return service.reject(request_id)


@router.post("/requests/{request_id}/apply", response_model=LeaveAttendanceRequest)
def apply(request_id: str, service: LeaveDep):
    """Record an approved request in OrangeHRM (book the leave / punch the employee out). Repeating it does nothing."""
    return service.apply(request_id)


@router.post("/workflows/{key}", response_model=LeaveWorkflowRun)
def run_workflow(key: str, container: ContainerDep):
    """Run one of the AutomationEdge showcase workflows and wait until it finishes (the portal's own calls do the real work)."""
    return run_showcase_workflow(container, _WORKFLOWS, key)

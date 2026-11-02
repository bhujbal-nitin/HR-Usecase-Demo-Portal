"""An employee whose offboarding is complete has been terminated in OrangeHRM: Leave and Reimbursement say so instead of failing inside OrangeHRM."""

from datetime import date

import pytest

from app.schemas.employee import Employee, EmployeeStatus
from app.schemas.offboarding import Offboarding, OffboardingStatus


def onboarded(container, ident: str, name: str) -> None:
    container.repository.add(Employee(
        id=ident, full_name=name, email=f"{ident.lower()}@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
        aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
        job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook", status=EmployeeStatus.APPROVED,
    ))


def offboard(container, ident: str, name: str, status: OffboardingStatus) -> None:
    container.leave._offboardings.add(Offboarding(
        id=f"OFF-{ident}", employee_id=ident, full_name=name, work_email="x@example.com", personal_email="y@example.com", department="Engineering",
        job_title="Engineer", manager="Amit D", hardware="MacBook", annual_ctc=1_200_000, reason="Better opportunity",
        last_working_day=date(2026, 12, 1), notice_period_days=30, status=status,
    ))


@pytest.fixture
def people(client):
    container = client.app.state.container
    onboarded(container, "AE-111111", "Aarav Sharma")
    onboarded(container, "AE-222222", "Meera Kulkarni")
    onboarded(container, "AE-333333", "Ishaan Rao")
    offboard(container, "AE-111111", "Aarav Sharma", OffboardingStatus.COMPLETED)
    offboard(container, "AE-333333", "Ishaan Rao", OffboardingStatus.PROCESSING)  # still working: not yet left
    return client


@pytest.mark.parametrize("url", ["/api/leave/lookup", "/api/reimbursement/lookup"])
def test_an_employee_who_has_left_is_refused_with_a_plain_message(people, url):
    reply = people.get(url, params={"ref": "AE-111111"})
    assert reply.status_code == 409
    assert "has left the company" in reply.text


@pytest.mark.parametrize("url", ["/api/leave/lookup", "/api/reimbursement/lookup"])
def test_current_employees_are_not_affected(people, url):
    assert people.get(url, params={"ref": "AE-222222"}).status_code == 200
    assert people.get(url, params={"ref": "AE-333333"}).status_code == 200  # offboarding in progress: still employed

"""A rebuilt OrangeHRM no longer has the profiles whose numbers were saved at onboarding: the portal must find or re-create them."""

from datetime import date

import pytest

from app.core.exceptions import IntegrationError
from app.integrations.orangehrm import ProfileNotFound, ProfileResult
from app.repositories.employee_repository import EmployeeRepository
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.services.employee_directory import resolve_emp_number


class FreshOrangeHRM:
    """Knows only the numbers in ``have``; ``named`` maps a full name to its number."""

    def __init__(self, have=(), named=None):
        self.have, self.named, self.created, self.asked = set(have), dict(named or {}), [], []

    def employee_exists(self, emp_number):
        self.asked.append(emp_number)
        return emp_number in self.have

    def find_employee_number(self, full_name):
        if full_name in self.named:
            return self.named[full_name]
        raise ProfileNotFound("OrangeHRM", f"no OrangeHRM profile named {full_name} was found")

    def create_employee_profile(self, emp, work_email, documents):
        self.created.append((emp.id, work_email, documents))
        return ProfileResult(OrangeHrmInfo(emp_number=300, employee_id="9", work_email=work_email, profile_url="u"))


def person(orange_hrm):
    return Employee(
        id="AE-111111", full_name="Aarav Sharma", email="aarav@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
        aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
        job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook",
        status=EmployeeStatus.APPROVED, orange_hrm=orange_hrm,
    )


@pytest.fixture
def repo(tmp_path):
    return EmployeeRepository(tmp_path / "employees.json")


def saved_number(repo):
    return repo.get("AE-111111").orange_hrm.emp_number


def test_a_saved_number_that_still_exists_is_used_as_it_is(repo):
    repo.add(person(OrangeHrmInfo(emp_number=77)))
    hrm = FreshOrangeHRM(have={77})
    assert resolve_emp_number(repo, hrm, repo.get("AE-111111")) == 77
    assert hrm.created == []


def test_a_missing_profile_is_found_by_name_and_the_new_number_saved(repo):
    repo.add(person(OrangeHrmInfo(emp_number=77, work_email="aarav@contoso.com")))
    hrm = FreshOrangeHRM(named={"Aarav Sharma": 12})
    assert resolve_emp_number(repo, hrm, repo.get("AE-111111")) == 12
    assert saved_number(repo) == 12
    assert repo.get("AE-111111").orange_hrm.work_email == "aarav@contoso.com"  # the rest of what onboarding recorded is kept
    assert hrm.created == []


def test_a_profile_that_is_nowhere_is_created_from_the_onboarding_details(repo):
    repo.add(person(OrangeHrmInfo(emp_number=77, work_email="aarav@contoso.com")))
    hrm = FreshOrangeHRM()
    assert resolve_emp_number(repo, hrm, repo.get("AE-111111")) == 300
    assert hrm.created == [("AE-111111", "aarav@contoso.com", [])]
    assert saved_number(repo) == 300


def test_an_employee_with_no_saved_number_is_looked_up_then_created(repo):
    repo.add(person(None))
    hrm = FreshOrangeHRM()
    assert resolve_emp_number(repo, hrm, repo.get("AE-111111")) == 300
    assert hrm.asked == []  # nothing saved, so nothing to confirm


def test_when_orangehrm_cannot_be_reached_nothing_is_created(repo):
    repo.add(person(OrangeHrmInfo(emp_number=77)))
    hrm = FreshOrangeHRM()

    def down(emp_number):
        raise IntegrationError("OrangeHRM", "login failed: timeout")

    hrm.employee_exists = down
    with pytest.raises(IntegrationError):
        resolve_emp_number(repo, hrm, repo.get("AE-111111"))
    assert hrm.created == [] and saved_number(repo) == 77


# ------------------------------------------------------------------------------------------ the real client's check
class Probe:
    """OrangeHRMClient with its web calls replaced by ``answers`` (a body, or an IntegrationError to raise)."""

    @staticmethod
    def make(answer):
        from app.integrations.orangehrm import OrangeHRMClient

        client = OrangeHRMClient.__new__(OrangeHRMClient)
        client._known_profiles, client.calls = {}, []

        def call(method, path, **kwargs):
            client.calls.append(path)
            if isinstance(answer, Exception):
                raise answer
            return answer

        client._leave_call = call
        return client


def test_the_client_says_a_profile_exists_and_remembers_it():
    client = Probe.make({"data": {"empNumber": 5}})
    assert client.employee_exists(5) and client.employee_exists(5)
    assert client.calls == ["pim/employees/5"]  # the second answer came from memory


@pytest.mark.parametrize("message", ["GET pim/employees/5 -> HTTP 404: Record Not Found", "GET x -> HTTP 422: Invalid Parameter (rejected: empNumber)"])
def test_the_client_says_missing_when_orangehrm_does_not_know_the_number(message):
    assert Probe.make(IntegrationError("OrangeHRM", message)).employee_exists(5) is False
    assert Probe.make({"data": None}).employee_exists(5) is False


def test_the_client_does_not_call_a_profile_missing_when_the_server_is_down():
    with pytest.raises(IntegrationError):
        Probe.make(IntegrationError("OrangeHRM", "login failed: timed out")).employee_exists(5)

"""The OrangeHRM leave/attendance and Microsoft 365 calendar calls: what they send and how they read the answers."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.core.exceptions import IntegrationError
from app.integrations.orangehrm_leave import LeaveAttendanceMixin


class Stub(LeaveAttendanceMixin):
    """The mixin with the HTTP layer replaced by canned answers; ``calls`` records what was sent."""

    base_url = "http://hrm.example/orangehrm"
    _s = SimpleNamespace(orangehrm_timezone_name="Asia/Kolkata", orangehrm_timezone_offset=5.5)

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def _leave_call(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def test_leave_types_skip_deleted_ones():
    stub = Stub({"data": [{"id": 1, "name": "Casual", "deleted": False}, {"id": 2, "name": "Old", "deleted": True}]})
    assert stub.leave_types() == [{"id": 1, "name": "Casual"}]


def test_balances_read_the_usage_breakdown_and_skip_types_without_entitlement():
    stub = Stub({"data": [
        {"leaveType": {"id": 1, "name": "Casual", "deleted": False}, "usageBreakdown": {"entitled": "18.00", "used": 4, "scheduled": 0, "pending": "1.5", "taken": 4, "balance": "12.5"}},
        {"leaveType": {"id": 2, "name": "Study", "deleted": False}, "usageBreakdown": None},
    ]})
    assert stub.leave_balances(77) == [{"leaveTypeId": 1, "leaveType": "Casual", "entitled": 18.0, "used": 4.0, "pending": 1.5, "balance": 12.5}]
    assert stub.calls[0][2]["params"]["empNumber"] == 77


def test_holidays_and_work_week():
    stub = Stub({"data": [{"id": 1, "name": "Founders Day", "date": "2026-11-04", "length": 0, "recurring": False}, {"name": "No date"}]},
                {"data": {"id": 1, "monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0, "friday": 0, "saturday": 4, "sunday": 8}})
    assert stub.holidays(date(2026, 11, 1), date(2026, 11, 30)) == [{"name": "Founders Day", "date": "2026-11-04", "length": 0}]
    assert stub.calls[0][2]["params"] == {"fromDate": "2026-11-01", "toDate": "2026-11-30", "limit": 100}
    assert stub.work_week()["saturday"] == 4


def test_overlap_means_leave_in_the_period_but_not_the_shift_length_answer():
    assert Stub({"data": [{"id": 1}], "meta": {"isWorkShiftLengthExceeded": False}}).has_overlapping_leave(77, date(2026, 11, 3), date(2026, 11, 4))
    assert not Stub({"data": [{"id": 1}], "meta": {"isWorkShiftLengthExceeded": True}}).has_overlapping_leave(77, date(2026, 11, 3), date(2026, 11, 4))
    assert not Stub({"data": [], "meta": {}}).has_overlapping_leave(77, date(2026, 11, 3), date(2026, 11, 4))


def test_assign_leave_sends_a_full_day_request_and_returns_a_link():
    stub = Stub({"data": {"id": 31}})
    result = stub.assign_leave(77, 1, date(2026, 11, 3), date(2026, 11, 4), "Family function")
    assert result == {"id": 31, "url": "http://hrm.example/orangehrm/web/index.php/leave/viewLeaveRequest/31"}
    method, path, kwargs = stub.calls[0]
    assert (method, path) == ("POST", "leave/employees/leave-requests")
    assert kwargs["json"] == {"empNumber": 77, "leaveTypeId": 1, "fromDate": "2026-11-03", "toDate": "2026-11-04", "comment": "Family function", "duration": {"type": "full_day"}}


def test_assign_leave_retries_once_with_partial_option_if_orangehrm_asks_for_it():
    stub = Stub(IntegrationError("OrangeHRM", "POST ... -> Invalid Parameter (rejected: partialOption)"), {"data": {"id": 32}})
    assert stub.assign_leave(77, 1, date(2026, 11, 3), date(2026, 11, 4), "x")["id"] == 32
    assert stub.calls[1][2]["json"]["partialOption"] == "none"
    with pytest.raises(IntegrationError):  # any other refusal is reported as it is
        Stub(IntegrationError("OrangeHRM", "boom")).assign_leave(77, 1, date(2026, 11, 3), date(2026, 11, 4), "x")


def test_attendance_records_and_punches():
    stub = Stub(
        {"data": [
            {"id": 5, "punchIn": {"userDate": "2026-10-26", "userTime": "09:12:00"}, "punchOut": {"userDate": None, "userTime": None}},
            {"id": 6, "punchIn": {"userDate": "2026-10-23", "userTime": "09:00"}, "punchOut": {"userDate": "2026-10-23", "userTime": "18:05:00"}},
        ]},
        {"data": {"id": 7}}, {"data": {"id": 7}},
    )
    records = stub.attendance_records(77, date(2026, 10, 20), date(2026, 10, 26))
    assert records[0] == {"id": 5, "inDate": "2026-10-26", "inTime": "09:12", "outDate": None, "outTime": None}
    assert records[1]["outTime"] == "18:05"

    stub.punch_in(77, date(2026, 10, 26), "09:12", "sample")
    stub.punch_out(77, date(2026, 10, 26), "18:30", "fixed")
    assert [c[0] for c in stub.calls[1:]] == ["POST", "PUT"] and stub.calls[1][1] == "attendance/employees/77/records"
    assert stub.calls[2][2]["json"] == {"date": "2026-10-26", "time": "18:30", "timezoneOffset": 5.5, "timezoneName": "Asia/Kolkata", "note": "fixed"}


# ------------------------------------------------------------------------------------- leave types and quotas
def test_create_leave_type_sends_the_name_and_returns_the_new_id():
    stub = Stub({"data": {"id": 7, "name": "Privilege Leave"}})
    assert stub.create_leave_type("Privilege Leave") == 7
    assert stub.calls[0][:2] == ("POST", "leave/leave-types") and stub.calls[0][2]["json"] == {"name": "Privilege Leave", "situational": False}
    with pytest.raises(IntegrationError, match="did not return an id"):
        Stub({"data": {}}).create_leave_type("X")


def test_add_entitlement_sends_the_period_and_days():
    stub = Stub({"data": {"id": 3}})
    stub.add_entitlement(77, 7, 15.0, date(2026, 1, 1), date(2026, 12, 31))
    assert stub.calls[0][:2] == ("POST", "leave/leave-entitlements")
    assert stub.calls[0][2]["json"] == {"empNumber": 77, "leaveTypeId": 7, "fromDate": "2026-01-01", "toDate": "2026-12-31", "entitlement": 15.0}


def test_leave_period_is_the_one_containing_the_day_else_the_calendar_year():
    periods = {"data": [{"startDate": "2025-04-01", "endDate": "2026-03-31"}, {"startDate": "2026-04-01", "endDate": "2027-03-31"}]}
    assert Stub(periods).leave_period(date(2026, 10, 28)) == (date(2026, 4, 1), date(2027, 3, 31))
    assert Stub(IntegrationError("OrangeHRM", "no such page")).leave_period(date(2026, 10, 28)) == (date(2026, 1, 1), date(2026, 12, 31))

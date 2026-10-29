"""Leave & attendance: the rules, the API and the approval of requests (OrangeHRM replaced by a fake)."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.exceptions import IntegrationError
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.services.leave import policy


def weekdays_between(start: date, end: date) -> int:
    return sum(1 for n in range((end - start).days + 1) if (start + timedelta(days=n)).weekday() < 5)


class FakeOrangeHRM:
    """The OrangeHRM calls the leave service makes. Casual (1) and Sick (2) exist, Privilege does not; Casual Leave has 18 days, 4 already taken."""

    def __init__(self):
        self.types = [{"id": 1, "name": "Casual Leave"}, {"id": 2, "name": "Sick Leave"}]
        self.created: list[str] = []
        self.quotas: list[dict] = []
        self.entitled, self.taken = {1: 18.0, 2: 12.0}, {1: 4.0, 2: 2.0}
        self.assigned: list[dict] = []
        self.records: list[dict] = []
        self.holiday_list: list[dict] = []
        self.fail: set[str] = set()

    def _maybe_fail(self, name: str) -> None:
        if name in self.fail:
            raise IntegrationError("OrangeHRM", f"{name} refused")

    def leave_types(self):
        self._maybe_fail("leave_types")
        return list(self.types)

    def create_leave_type(self, name):
        self._maybe_fail("create_leave_type")
        self.types.append({"id": len(self.types) + 1, "name": name})
        self.created.append(name)
        return len(self.types)

    def leave_period(self, day):
        return date(day.year, 1, 1), date(day.year, 12, 31)

    def add_entitlement(self, emp_number, leave_type_id, days, start, end):
        self._maybe_fail("add_entitlement")
        self.quotas.append({"emp": emp_number, "type": leave_type_id, "days": days, "start": start, "end": end})
        self.entitled[leave_type_id], self.taken[leave_type_id] = days, 0.0

    def leave_balances(self, emp_number):
        self._maybe_fail("leave_balances")
        rows = []
        for t in self.types:
            if t["id"] not in self.entitled:
                continue
            booked = sum(a["days"] for a in self.assigned if a["emp"] == emp_number and a["type"] == t["id"])
            rows.append({
                "leaveTypeId": t["id"], "leaveType": t["name"], "entitled": self.entitled[t["id"]], "used": self.taken[t["id"]] + booked,
                "pending": 0.0, "balance": self.entitled[t["id"]] - self.taken[t["id"]] - booked,
            })
        return rows

    def holidays(self, start, end):
        return [h for h in self.holiday_list if start <= date.fromisoformat(h["date"]) <= end]

    def work_week(self):
        return {}  # OrangeHRM does not say: Monday to Friday

    def has_overlapping_leave(self, emp_number, start, end):
        return any(a["emp"] == emp_number and a["start"] <= end and start <= a["end"] for a in self.assigned)

    def assign_leave(self, emp_number, leave_type_id, start, end, comment):
        self._maybe_fail("assign_leave")
        self.assigned.append({"emp": emp_number, "type": leave_type_id, "start": start, "end": end, "days": weekdays_between(start, end), "comment": comment})
        return {"id": 900 + len(self.assigned), "url": f"http://hrm.example/leave/{900 + len(self.assigned)}"}

    def attendance_records(self, emp_number, start, end):
        self._maybe_fail("attendance_records")
        return [r for r in self.records if r["emp"] == emp_number and start.isoformat() <= r["inDate"] <= end.isoformat()]

    def punch_in(self, emp_number, day, clock, note):
        self.records.append({"emp": emp_number, "id": len(self.records) + 1, "inDate": day.isoformat(), "inTime": clock, "outDate": None, "outTime": None})

    def punch_out(self, emp_number, day, clock, note):
        self._maybe_fail("punch_out")
        latest_open = [r for r in self.records if r["emp"] == emp_number and r["outTime"] is None][-1]
        latest_open["outDate"], latest_open["outTime"] = day.isoformat(), clock

    def attendance_url(self):
        return "http://hrm.example/attendance"

    def find_employee_number(self, full_name):
        return 55


def working_pair(offset: int = 10) -> tuple[date, date]:
    """Two consecutive weekdays (Monday to Thursday, then the next day) in the future."""
    day = date.today() + timedelta(days=offset)
    while day.weekday() > 3:
        day += timedelta(days=1)
    return day, day + timedelta(days=1)


@pytest.fixture
def world(client):
    container = client.app.state.container
    people = (("EMP-111111", "Aarav Sharma", 77), ("EMP-222222", "Meera Kulkarni", None))  # the second one has no OrangeHRM number recorded
    for ident, name, emp_number in people:
        container.repository.add(Employee(
            id=ident, full_name=name, email=f"{ident.lower()}@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
            aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
            job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook",
            status=EmployeeStatus.APPROVED,
            orange_hrm=OrangeHrmInfo(emp_number=emp_number) if emp_number else None,
        ))
    gw = container.leave._gw
    gw.orangehrm = FakeOrangeHRM()
    return client, gw


def leave_body(start: date, end: date, leave_type: str = "Casual Leave", ref: str = "EMP-111111") -> dict:
    return {"employeeRef": ref, "leaveType": leave_type, "startDate": start.isoformat(), "endDate": end.isoformat(), "reason": "Family function"}


def balance(client, leave_type: str = "Casual Leave", ref: str = "EMP-111111") -> dict:
    return next(b for b in client.get("/api/leave/balances", params={"ref": ref}).json() if b["leaveType"] == leave_type)


# ------------------------------------------------------------------------------------------------- the rules
def test_working_days_use_the_work_week_and_holidays():
    mon, fri = date(2026, 11, 2), date(2026, 11, 6)
    assert policy.working_days(mon, date(2026, 11, 8), policy.DEFAULT_WORK_WEEK, {}) == 5
    assert policy.working_days(mon, date(2026, 11, 8), {**policy.DEFAULT_WORK_WEEK, "saturday": 0}, {}) == 6  # OrangeHRM says Saturday works
    holidays = policy.full_day_holidays([{"name": "Founders Day", "date": "2026-11-04", "length": 0}, {"name": "Half", "date": "2026-11-05", "length": 4}])
    assert policy.working_days(mon, fri, policy.DEFAULT_WORK_WEEK, holidays) == 4  # a half-day holiday still counts as a working day
    assert [h.name for h in policy.holidays_skipped(mon, fri, policy.DEFAULT_WORK_WEEK, holidays)] == ["Founders Day"]


def test_previous_working_days_go_backwards_over_the_weekend():
    assert policy.previous_working_days(date(2026, 11, 2), 2, policy.DEFAULT_WORK_WEEK, {}) == [date(2026, 10, 30), date(2026, 10, 29)]


def test_hours_worked():
    assert policy.hours_worked("09:12", "18:30") == "9h 18m"


# ------------------------------------------------------------------------------------------------------ reads
def test_lookup_options_balances_and_holidays(world):
    client, gw = world
    assert client.get("/api/leave/lookup", params={"ref": "emp-111111"}).json()["workEmail"] == "emp-111111@example.com"
    assert client.get("/api/leave/lookup", params={"ref": "nobody@x.com"}).status_code == 404

    assert client.get("/api/leave/options").json()["leaveTypes"] == ["Casual Leave", "Sick Leave", "Privilege Leave"]
    assert gw.orangehrm.created == ["Privilege Leave"]  # the missing standard type was created, the existing two were not
    client.get("/api/leave/options")
    assert gw.orangehrm.created == ["Privilege Leave"]  # and nothing is created twice
    assert (balance(client)["total"], balance(client)["used"], balance(client)["left"]) == (18, 4, 14)
    assert balance(client, ref="EMP-222222")["left"] == 14  # no recorded number: found by name

    soon, later = date.today() + timedelta(days=20), date.today() + timedelta(days=5)
    gw.orangehrm.holiday_list = [{"name": "Later", "date": soon.isoformat(), "length": 0}, {"name": "Sooner", "date": later.isoformat(), "length": 0}]
    assert [h["name"] for h in client.get("/api/leave/holidays").json()] == ["Sooner", "Later"]


# ----------------------------------------------------------------------------------------------- leave checks
def test_check_reports_days_balance_and_skipped_holidays(world):
    client, gw = world
    start, end = working_pair()
    check = client.post("/api/leave/check", json=leave_body(start, end)).json()
    assert check["ok"] and check["days"] == 2 and (check["balanceBefore"], check["balanceAfter"]) == (14, 12) and check["problems"] == []

    gw.orangehrm.holiday_list = [{"name": "Founders Day", "date": end.isoformat(), "length": 0}]
    check = client.post("/api/leave/check", json=leave_body(start, end)).json()
    assert check["days"] == 1 and [h["name"] for h in check["holidaysSkipped"]] == ["Founders Day"]


def test_check_finds_each_problem(world):
    client, gw = world
    start, end = working_pair()
    past = client.post("/api/leave/check", json=leave_body(date.today() - timedelta(days=3), date.today() - timedelta(days=2))).json()
    assert not past["ok"] and "past" in past["problems"][0]

    saturday = date.today() + timedelta(days=(5 - date.today().weekday()) % 7 + 7)
    assert "weekends or holidays" in client.post("/api/leave/check", json=leave_body(saturday, saturday + timedelta(days=1))).json()["problems"][0]

    long = client.post("/api/leave/check", json=leave_body(start, start + timedelta(days=40), "Sick Leave")).json()
    assert any("left" in p for p in long["problems"])
    assert client.post("/api/leave/check", json=leave_body(start, end, "Moon Leave")).status_code == 422
    assert client.post("/api/leave/check", json=leave_body(end, start)).status_code == 422  # ends before it starts

    gw.orangehrm.assigned.append({"emp": 77, "type": 1, "start": start, "end": end, "days": 2, "comment": ""})
    assert "already have leave in these dates in OrangeHRM" in client.post("/api/leave/check", json=leave_body(start, end)).json()["problems"][0]


def test_a_failing_orangehrm_call_is_reported_not_hidden(world):
    client, gw = world
    gw.orangehrm.fail.add("leave_balances")
    start, end = working_pair()
    answer = client.post("/api/leave/check", json=leave_body(start, end))
    assert answer.status_code == 502 and "leave_balances refused" in answer.json()["detail"]


# ----------------------------------------------------------------------------------------- applying and approval
def test_leave_is_held_until_it_is_recorded_in_orangehrm(world):
    client, gw = world
    start, end = working_pair()
    created = client.post("/api/leave/requests/leave", json=leave_body(start, end))
    assert created.status_code == 201
    request = created.json()
    assert request["id"].startswith("LV-") and request["status"] == "Pending Approval" and request["days"] == 2 and request["balanceAfter"] == 12
    assert balance(client)["left"] == 12 and balance(client)["pending"] == 2  # held while it waits; OrangeHRM does not know yet
    assert client.post(f"/api/leave/requests/{request['id']}/apply").status_code == 409  # not approved yet

    approved = client.post(f"/api/leave/requests/{request['id']}/approve").json()
    assert approved["status"] == "Approved" and approved["applied"] is False and gw.orangehrm.assigned == []
    assert balance(client)["left"] == 12  # an approved request that is not recorded yet is still held

    done = client.post(f"/api/leave/requests/{request['id']}/apply").json()
    assert done["applied"] and done["orangeHrmId"] == 901 and done["orangeHrmUrl"].endswith("/901")
    assert len(gw.orangehrm.assigned) == 1 and gw.orangehrm.assigned[0]["type"] == 1 and gw.orangehrm.assigned[0]["emp"] == 77
    assert (balance(client)["left"], balance(client)["pending"], balance(client)["used"]) == (12, 0, 6)  # now OrangeHRM's own figures

    client.post(f"/api/leave/requests/{request['id']}/apply")
    assert len(gw.orangehrm.assigned) == 1  # recording twice does nothing
    assert client.post(f"/api/leave/requests/{request['id']}/approve").status_code == 409


def test_a_failed_recording_can_be_retried(world):
    client, gw = world
    start, end = working_pair()
    request = client.post("/api/leave/requests/leave", json=leave_body(start, end)).json()
    client.post(f"/api/leave/requests/{request['id']}/approve")
    gw.orangehrm.fail.add("assign_leave")
    assert client.post(f"/api/leave/requests/{request['id']}/apply").status_code == 502
    assert client.get(f"/api/leave/requests/{request['id']}").json()["applied"] is False and balance(client)["left"] == 12  # still held
    gw.orangehrm.fail.clear()
    assert client.post(f"/api/leave/requests/{request['id']}/apply").json()["applied"] is True


def test_rejecting_gives_the_days_back_and_overlaps_are_refused(world):
    client, _ = world
    start, end = working_pair()
    request = client.post("/api/leave/requests/leave", json=leave_body(start, end)).json()
    again = client.post("/api/leave/requests/leave", json=leave_body(start, end))
    assert again.status_code == 422 and request["id"] in again.json()["detail"]  # overlaps the first one

    assert client.post(f"/api/leave/requests/{request['id']}/reject").json()["status"] == "Rejected"
    assert balance(client)["left"] == 14
    assert client.post("/api/leave/requests/leave", json=leave_body(start, end)).status_code == 201  # free again


def test_a_leave_that_does_not_pass_the_checks_is_not_saved(world):
    client, _ = world
    start, _ = working_pair()
    assert client.post("/api/leave/requests/leave", json=leave_body(start, start + timedelta(days=40), "Sick Leave")).status_code == 422
    assert client.get("/api/leave/requests").json() == []


# ----------------------------------------------------------------------------------------------- attendance
def test_the_demo_sets_up_a_missing_punch_and_the_correction_is_recorded(world):
    client, gw = world
    ref = {"ref": "EMP-111111"}
    assert client.get("/api/leave/attendance", params=ref).json() == {"days": [], "missing": []}  # nothing in OrangeHRM yet

    prepared = client.post("/api/leave/attendance/demo-punch", params=ref).json()
    assert prepared["created"] is True and len(gw.orangehrm.records) == 1 and gw.orangehrm.records[0]["inTime"] == "09:12"
    assert client.post("/api/leave/attendance/demo-punch", params=ref).json()["created"] is False  # one is enough
    assert len(gw.orangehrm.records) == 1

    log = client.get("/api/leave/attendance", params=ref).json()
    day = prepared["day"]
    assert [d["date"] for d in log["missing"]] == [day] and log["missing"][0]["outPunch"] is None

    body = {"employeeRef": "EMP-111111", "attendanceDate": day, "outPunch": "18:30", "reason": "Scanner was offline"}
    request = client.post("/api/leave/requests/regularization", json=body).json()
    assert request["id"].startswith("AT-") and request["inPunch"] == "09:12" and request["hoursWorked"] == "9h 18m"
    assert client.get("/api/leave/attendance", params=ref).json()["days"][0]["state"] == "pending"
    assert client.post("/api/leave/requests/regularization", json=body).status_code == 422  # already waiting

    client.post(f"/api/leave/requests/{request['id']}/approve")
    assert gw.orangehrm.records[0]["outTime"] is None  # approved, not yet recorded
    done = client.post(f"/api/leave/requests/{request['id']}/apply").json()
    assert done["applied"] and gw.orangehrm.records[0]["outTime"] == "18:30" and gw.orangehrm.records[0]["outDate"] == day
    assert client.get("/api/leave/attendance", params=ref).json()["days"][0] == {"date": day, "inPunch": "09:12", "outPunch": "18:30", "state": "ok"}


def test_regularization_validation(world):
    client, _ = world
    day = client.post("/api/leave/attendance/demo-punch", params={"ref": "EMP-111111"}).json()["day"]
    base = {"employeeRef": "EMP-111111", "attendanceDate": day, "outPunch": "18:30", "reason": "Forgot"}
    assert client.post("/api/leave/requests/regularization", json={**base, "outPunch": "6:30pm"}).status_code == 422
    assert "after the in-punch" in client.post("/api/leave/requests/regularization", json={**base, "outPunch": "08:00"}).json()["detail"]
    other = (date.fromisoformat(day) - timedelta(days=3)).isoformat()
    assert "no missing out-punch" in client.post("/api/leave/requests/regularization", json={**base, "attendanceDate": other}).json()["detail"]


def test_clear_removes_decided_requests_only(world):
    client, gw = world
    start, end = working_pair()
    done = client.post("/api/leave/requests/leave", json=leave_body(start, end)).json()
    client.post(f"/api/leave/requests/{done['id']}/approve")
    client.post(f"/api/leave/requests/{done['id']}/apply")
    pending = client.post("/api/leave/requests/leave", json=leave_body(*working_pair(40))).json()

    assert client.delete("/api/leave/requests").json() == {"removed": 1}
    assert [r["id"] for r in client.get("/api/leave/requests").json()] == [pending["id"]]
    assert len(gw.orangehrm.assigned) == 1 and balance(client)["used"] == 6  # what OrangeHRM recorded stays


# ------------------------------------------------------------------------------------------- AutomationEdge showcase workflows
class FakeAutomationEdge:
    def __init__(self, status="Complete"):
        self.status, self.ran = status, []

    def __getattr__(self, method):
        def run():
            self.ran.append(method)
            return SimpleNamespace(workflow_name=f"WF {method}", execution_status=self.status, ok=self.status == "Complete",
                                   automation_request_id=501, agent_name="agent-1", message="done", instance_url=None)
        return run


@pytest.mark.parametrize("key, method", [
    ("balance", "leave_balance"), ("check", "check_leave_request"),
    ("assign-leave", "assign_leave_orangehrm"), ("attendance", "attendance_records"), ("punch-in", "add_punch_in_orangehrm"),
    ("punch-out", "punch_out_orangehrm"),
])
def test_each_showcase_workflow_runs_its_own_automationedge_workflow(world, key, method):
    client, _ = world
    ae = client.app.state.container.automationedge = FakeAutomationEdge()
    body = client.post(f"/api/leave/workflows/{key}").json()
    assert ae.ran == [method]
    assert body["ok"] is True and body["status"] == "Complete" and body["automationRequestId"] == 501


def test_a_workflow_that_does_not_complete_is_reported_not_ok(world):
    client, _ = world
    client.app.state.container.automationedge = FakeAutomationEdge("Failure")
    body = client.post("/api/leave/workflows/balance").json()
    assert body["ok"] is False and body["status"] == "Failure"


def test_an_unknown_workflow_is_404_and_unconfigured_automationedge_is_a_clear_error(world):
    client, _ = world
    assert client.post("/api/leave/workflows/nope").status_code == 404
    response = client.post("/api/leave/workflows/balance")  # the test settings have no AutomationEdge credentials
    assert response.status_code == 502 and "not configured" in response.json()["detail"]


# ------------------------------------------------------------------------------------------------------ default quotas
def test_an_employee_without_a_quota_is_given_the_default_one(world):
    client, gw = world
    start, end = working_pair()
    check = client.post("/api/leave/check", json=leave_body(start, end, "Privilege Leave")).json()  # nobody has Privilege Leave yet
    assert check["ok"] and check["balanceBefore"] == 15
    assert [(q["emp"], q["days"]) for q in gw.orangehrm.quotas] == [(77, 15.0)]
    assert gw.orangehrm.quotas[0]["start"] == date(date.today().year, 1, 1)
    client.post("/api/leave/check", json=leave_body(start, end, "Privilege Leave"))
    assert len(gw.orangehrm.quotas) == 1  # a quota that exists is never added again


def test_the_balances_give_every_standard_type_a_quota_and_only_those_are_shown(world):
    client, gw = world
    gw.orangehrm.types.append({"id": 9, "name": "Study Leave"})
    gw.orangehrm.entitled[9], gw.orangehrm.taken[9] = 5.0, 0.0  # an extra type the demo does not use
    shown = {b["leaveType"]: b["total"] for b in client.get("/api/leave/balances", params={"ref": "EMP-111111"}).json()}
    assert shown == {"Casual Leave": 18, "Sick Leave": 12, "Privilege Leave": 15}


def test_a_refused_quota_is_reported_not_hidden(world):
    client, gw = world
    gw.orangehrm.fail.add("add_entitlement")
    start, end = working_pair()
    answer = client.post("/api/leave/check", json=leave_body(start, end, "Privilege Leave"))
    assert answer.status_code == 502 and "add_entitlement refused" in answer.json()["detail"]

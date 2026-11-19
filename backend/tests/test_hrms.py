"""The built-in OrangeHRM replica (/api/hrms): its own rules, and the portal's real OrangeHRM client running against it."""

import re
import socket
import threading
import time
from datetime import date, timedelta

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.integrations.orangehrm import OrangeHRMClient
from app.main import create_app

PAGES = "/api/hrms/web/index.php"
V2 = f"{PAGES}/api/v2"


def a_monday() -> date:
    """A Monday inside the current year (so the year's default entitlement period covers it), a week or more from today."""
    day = date.today() + timedelta(days=7)
    day += timedelta(days=-day.weekday())
    if day.year != date.today().year:
        day = date.today() - timedelta(days=7)
        day -= timedelta(days=day.weekday())
    return day


def _settings(tmp_path, **extra) -> Settings:
    return Settings(_env_file=None, data_dir=tmp_path / "data", offers_dir=tmp_path / "offers", hr_documents_dir=tmp_path / "hr",
                    google_credentials_file=tmp_path / "none.json", approval_poller_enabled=False, **{"hrms_enabled": False, **extra})


@pytest.fixture
def hrms(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        assert client.post(f"{PAGES}/auth/validate-json", json={"username": "Admin", "password": "admin123"}).status_code == 200
        yield client


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def new_employee(client, first="Asha", last="Rao", **extra) -> int:
    return ok(client.post(f"{V2}/pim/employees", json={"firstName": first, "lastName": last, **extra}))["data"]["empNumber"]


def type_id(client, name="Casual Leave") -> int:
    return next(t["id"] for t in ok(client.get(f"{V2}/leave/leave-types"))["data"] if t["name"] == name)


def entitle(client, emp: int, days: float, kind: int | None = None) -> None:
    year = date.today().year
    ok(client.post(f"{V2}/leave/leave-entitlements", json={"empNumber": emp, "leaveTypeId": kind or type_id(client), "fromDate": f"{year}-01-01", "toDate": f"{year}-12-31", "entitlement": days}))


def balance(client, emp: int, name="Casual Leave") -> dict:
    rows = ok(client.get(f"{V2}/leave/employees/leave-balances", params={"empNumber": emp}))["data"]
    return next(r["usageBreakdown"] for r in rows if r["leaveType"]["name"] == name)


# ------------------------------------------------------------------------------------------- login
def test_the_login_page_carries_the_token_the_client_reads(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        page = client.get(f"{PAGES}/auth/login").text
        assert re.search(r':token="&quot;([^&]+)&quot;"', page)


def test_login_by_form_sets_the_cookie_and_a_bad_password_does_not(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        token = re.search(r':token="&quot;([^&]+)&quot;"', client.get(f"{PAGES}/auth/login").text).group(1)
        bad = client.post(f"{PAGES}/auth/validate", data={"_token": token, "username": "Admin", "password": "nope"}, follow_redirects=False)
        assert bad.status_code == 302 and bad.headers["location"].endswith("/auth/login") and "orangehrm" not in client.cookies
        forged = client.post(f"{PAGES}/auth/validate", data={"_token": "x", "username": "Admin", "password": "admin123"}, follow_redirects=False)
        assert forged.headers["location"].endswith("/auth/login")
        good = client.post(f"{PAGES}/auth/validate", data={"_token": token, "username": "Admin", "password": "admin123"}, follow_redirects=False)
        assert good.status_code == 302 and good.headers["location"].endswith("/dashboard/index")
        assert ok(client.get(f"{V2}/auth/session"))["data"]["username"] == "Admin"
        assert client.post(f"{PAGES}/auth/logout").status_code == 200
        assert client.get(f"{V2}/pim/employees").status_code == 401


def test_the_json_login_rejects_a_wrong_password(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        assert client.post(f"{PAGES}/auth/validate-json", json={"username": "Admin", "password": "wrong"}).status_code == 401


def test_the_api_without_a_session_is_401_session_expired(tmp_path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = client.get(f"{V2}/pim/employees?limit=1")
        assert response.status_code == 401
        assert response.json() == {"error": {"status": "401", "message": "Session expired"}}


def test_the_replica_does_not_need_the_portal_login(tmp_path):
    secured = _settings(tmp_path, auth_enabled=True)
    with TestClient(create_app(secured)) as client:
        assert client.get("/api/employees").status_code == 401  # the portal itself is still locked
        assert client.get(f"{PAGES}/auth/login").status_code == 200


# ----------------------------------------------------------------------------------------------- PIM
def test_employees_can_be_created_listed_and_terminated(hrms):
    first = new_employee(hrms, "Asha", "Rao", employeeId="A100")
    assert ok(hrms.get(f"{V2}/pim/employees/{first}"))["data"]["employeeId"] == "A100"
    duplicate = hrms.post(f"{V2}/pim/employees", json={"firstName": "Bo", "lastName": "Li", "employeeId": "a100"})
    assert duplicate.status_code == 422 and duplicate.json()["error"]["data"]["invalidParamKeys"] == ["employeeId"]
    assert hrms.post(f"{V2}/pim/employees", json={"firstName": "", "lastName": "X"}).json()["error"]["data"]["invalidParamKeys"] == ["firstName"]
    auto = ok(hrms.post(f"{V2}/pim/employees", json={"firstName": "Chen", "lastName": "Wu"}))["data"]
    assert auto["employeeId"].isdigit()

    found = ok(hrms.get(f"{V2}/pim/employees", params={"nameOrId": "asha rao"}))
    assert [e["empNumber"] for e in found["data"]] == [first] and found["meta"]["total"] == 1

    reasons = ok(hrms.get(f"{V2}/pim/termination-reasons"))["data"]
    resigned = next(r["id"] for r in reasons if r["name"] == "Resigned")
    ok(hrms.post(f"{V2}/pim/employees/{first}/terminations", json={"date": date.today().isoformat(), "terminationReasonId": resigned, "note": "bye"}))
    assert hrms.post(f"{V2}/pim/employees/{first}/terminations", json={"date": date.today().isoformat(), "terminationReasonId": resigned}).status_code == 422
    assert ok(hrms.get(f"{V2}/pim/employees", params={"nameOrId": "asha"}))["data"] == []
    past = ok(hrms.get(f"{V2}/pim/employees", params={"nameOrId": "asha", "includeEmployees": "currentAndPast"}))["data"]
    assert past[0]["terminationId"]
    assert hrms.post(f"{V2}/leave/employees/leave-requests", json={"empNumber": first, "leaveTypeId": type_id(hrms), "fromDate": a_monday().isoformat(), "toDate": a_monday().isoformat(), "duration": {"type": "full_day"}}).status_code == 422


def test_a_missing_employee_is_404_naming_the_empnumber(hrms):
    response = hrms.get(f"{V2}/pim/employees/9999")
    assert response.status_code == 404 and "empNumber" in response.json()["error"]["message"]


def test_contact_details_refuse_an_email_another_employee_uses(hrms):
    one, two = new_employee(hrms, "One", "A"), new_employee(hrms, "Two", "B")
    ok(hrms.put(f"{V2}/pim/employee/{one}/contact-details", json={"workEmail": "one@corp.example", "mobile": "999"}))
    clash = hrms.put(f"{V2}/pim/employee/{two}/contact-details", json={"workEmail": "ONE@corp.example"})
    assert clash.status_code == 422 and clash.json()["error"]["data"]["invalidParamKeys"] == ["workEmail"]
    clash = hrms.put(f"{V2}/pim/employee/{two}/contact-details", json={"otherEmail": "one@corp.example"})
    assert clash.json()["error"]["data"]["invalidParamKeys"] == ["otherEmail"]
    assert ok(hrms.get(f"{V2}/pim/employee/{one}/contact-details"))["data"]["mobile"] == "999"


def test_personal_job_emergency_salary_and_attachments(hrms):
    emp = new_employee(hrms)
    ok(hrms.put(f"{V2}/pim/employees/{emp}/personal-details", json={"firstName": "Asha", "lastName": "Rao", "birthday": "1990-05-04", "otherId": "123"}))
    ok(hrms.put(f"{V2}/pim/employees/{emp}/job-details", json={"joinedDate": "2024-01-02", "jobTitle": "Engineer", "subunit": "Data"}))
    job = ok(hrms.get(f"{V2}/pim/employees/{emp}/job-details"))["data"]
    assert job["jobTitle"]["title"] == "Engineer" and job["subunit"]["name"] == "Data" and job["joinedDate"] == "2024-01-02"
    ok(hrms.post(f"{V2}/pim/employees/{emp}/emergency-contacts", json={"name": "Mum", "relationship": "Family", "mobilePhone": "1"}))
    assert hrms.post(f"{V2}/pim/employees/{emp}/emergency-contacts", json={"name": "", "relationship": "x"}).status_code == 422
    ok(hrms.post(f"{V2}/pim/employees/{emp}/salary-components", json={"salaryComponent": "CTC", "salaryAmount": "1200000", "currencyId": "INR"}))
    row = ok(hrms.get(f"{V2}/pim/employees/{emp}/salary-components"))["data"][0]
    assert row["salaryName"] == "CTC" and float(row["amount"]) == 1200000 and row["currencyType"]["id"] == "INR"
    assert hrms.post(f"{V2}/pim/employees/{emp}/salary-components", json={"salaryComponent": "CTC", "salaryAmount": "abc", "currencyId": "INR"}).status_code == 422
    import base64
    attached = ok(hrms.post(f"{V2}/pim/employees/{emp}/screen/personal/attachments", json={"attachment": {"name": "a.pdf", "type": "application/pdf", "size": 3, "base64": base64.b64encode(b"%PD").decode()}, "description": "d"}))["data"]
    assert ok(hrms.get(f"{V2}/pim/employees/{emp}/screen/personal/attachments"))["data"][0]["filename"] == "a.pdf"
    assert hrms.get(f"{V2}/pim/employees/{emp}/screen/personal/attachments/{attached['id']}").content == b"%PD"


# ---------------------------------------------------------------------------------------------- Leave
def test_entitlement_balance_assign_and_overlap(hrms):
    emp = new_employee(hrms)
    assert next(r for r in ok(hrms.get(f"{V2}/leave/employees/leave-balances", params={"empNumber": emp}))["data"])["usageBreakdown"] is None
    entitle(hrms, emp, 5)
    entitle(hrms, emp, 2)  # added to the matching entitlement
    assert balance(hrms, emp)["entitled"] == 7 and balance(hrms, emp)["balance"] == 7

    monday = a_monday()
    body = {"empNumber": emp, "leaveTypeId": type_id(hrms), "fromDate": monday.isoformat(), "toDate": (monday + timedelta(days=2)).isoformat(), "comment": "trip", "duration": {"type": "full_day"}}
    booked = ok(hrms.post(f"{V2}/leave/employees/leave-requests", json=body))["data"]
    assert booked["noOfDays"] == 3
    after = balance(hrms, emp)
    assert after["balance"] == 4 and after["used"] + after["scheduled"] == 3

    overlap = ok(hrms.get(f"{V2}/leave/overlap-leaves", params={"empNumber": emp, "fromDate": monday.isoformat(), "toDate": monday.isoformat(), "duration[type]": "full_day"}))
    assert overlap["data"] and not overlap["meta"].get("isWorkShiftLengthExceeded")
    free = monday + timedelta(days=7)
    none = ok(hrms.get(f"{V2}/leave/overlap-leaves", params={"empNumber": emp, "fromDate": free.isoformat(), "toDate": free.isoformat(), "duration[type]": "full_day"}))
    assert none["data"] == [] and none["meta"]["isWorkShiftLengthExceeded"] is True
    assert hrms.post(f"{V2}/leave/employees/leave-requests", json=body).status_code == 422  # same days again

    ok(hrms.put(f"{V2}/leave/employees/leave-requests/{booked['id']}", json={"action": "CANCEL"}))
    assert balance(hrms, emp)["balance"] == 7
    assert hrms.put(f"{V2}/leave/employees/leave-requests/{booked['id']}", json={"action": "CANCEL"}).status_code == 422


def test_weekends_and_holidays_are_not_counted_and_the_balance_must_cover_the_leave(hrms):
    emp = new_employee(hrms)
    entitle(hrms, emp, 3)
    monday = a_monday()
    friday_to_next_monday = {"empNumber": emp, "leaveTypeId": type_id(hrms), "fromDate": (monday + timedelta(days=4)).isoformat(),
                             "toDate": (monday + timedelta(days=7)).isoformat(), "duration": {"type": "full_day"}}
    assert ok(hrms.post(f"{V2}/leave/employees/leave-requests", json=friday_to_next_monday))["data"]["noOfDays"] == 2  # Fri + Mon

    tuesday = monday + timedelta(days=15)  # a Wednesday two weeks on; make it a holiday
    ok(hrms.post(f"{V2}/leave/holidays", json={"name": "Test Day", "date": tuesday.isoformat(), "length": 0}))
    assert hrms.post(f"{V2}/leave/holidays", json={"name": "Again", "date": tuesday.isoformat()}).status_code == 422
    only_holiday = {**friday_to_next_monday, "fromDate": tuesday.isoformat(), "toDate": tuesday.isoformat()}
    assert "No Working Days" in hrms.post(f"{V2}/leave/employees/leave-requests", json=only_holiday).json()["error"]["message"]

    too_long = {**friday_to_next_monday, "fromDate": (monday + timedelta(days=21)).isoformat(), "toDate": (monday + timedelta(days=24)).isoformat()}
    response = hrms.post(f"{V2}/leave/employees/leave-requests", json=too_long)  # 4 working days, 1 left
    assert response.status_code == 422 and response.json()["error"]["message"] == "Failed to Submit: Leave Balance Exceeded"


def test_leave_types_periods_and_work_week(hrms):
    assert {"Casual Leave", "Sick Leave", "Privilege Leave"} <= {t["name"] for t in ok(hrms.get(f"{V2}/leave/leave-types"))["data"]}
    created = ok(hrms.post(f"{V2}/leave/leave-types", json={"name": "Study Leave", "situational": False}))["data"]
    assert created["id"] and hrms.post(f"{V2}/leave/leave-types", json={"name": "study leave"}).json()["error"]["data"]["invalidParamKeys"] == ["name"]
    periods = ok(hrms.get(f"{V2}/leave/leave-periods"))["data"]
    year = date.today().year
    assert any(p["startDate"] == f"{year}-01-01" and p["endDate"] == f"{year}-12-31" for p in periods)
    week = ok(hrms.get(f"{V2}/leave/workweek"))["data"]
    assert week["monday"] == 0 and week["saturday"] == 8 and week["sunday"] == 8
    holidays = ok(hrms.get(f"{V2}/leave/holidays", params={"fromDate": f"{year}-01-01", "toDate": f"{year}-12-31"}))["data"]
    assert any(h["name"] == "Republic Day" and h["length"] == 0 for h in holidays)


# ----------------------------------------------------------------------------------------- Attendance
def test_punch_in_out_validation_and_delete(hrms):
    emp = new_employee(hrms)
    day = date.today().isoformat()
    url = f"{V2}/attendance/employees/{emp}/records"
    punch = lambda time_, note="": {"date": day, "time": time_, "timezoneOffset": 5.5, "timezoneName": "Asia/Kolkata", "note": note}
    assert hrms.put(url, json=punch("17:00")).status_code == 422  # nothing to punch out of
    ok(hrms.post(url, json=punch("09:30", "in")))
    assert hrms.post(url, json=punch("10:00")).status_code == 422  # already punched in
    assert hrms.put(url, json=punch("09:00")).status_code == 422  # out before in
    out = ok(hrms.put(url, json=punch("18:00")))["data"]
    assert out["state"]["id"] == "PUNCHED OUT" and out["total"] == 8.5
    assert hrms.post(url, json=punch("12:00")).json()["error"]["message"] == "Overlapping Records Found"
    assert hrms.post(url, json={**punch("25:00")}).status_code == 422

    rows = ok(hrms.get(url, params={"fromDate": day, "toDate": day}))["data"]
    assert rows[0]["punchIn"]["userTime"] == "09:30" and rows[0]["punchOut"]["userDate"] == day
    summary = ok(hrms.get(f"{V2}/attendance/employees/summary", params={"fromDate": day, "toDate": day}))["data"]
    assert next(r for r in summary if r["empNumber"] == emp)["total"] == 8.5
    assert ok(hrms.request("DELETE", url, json={"ids": [rows[0]["id"]]}))["data"] == [rows[0]["id"]]
    assert ok(hrms.get(url))["data"] == []


# --------------------------------------------------------------------------------------------- Claim
def test_claim_status_flow(hrms):
    emp = new_employee(hrms)
    event = ok(hrms.post(f"{V2}/claim/events", json={"name": "Offsite", "description": "", "status": True}))["data"]["id"]
    assert hrms.post(f"{V2}/claim/events", json={"name": "offsite"}).status_code == 422
    kind = ok(hrms.post(f"{V2}/claim/expenses/types", json={"name": "Taxi", "description": "", "status": True}))["data"]["id"]
    claim = ok(hrms.post(f"{V2}/claim/employees/{emp}/requests", json={"claimEventId": event, "currencyId": "INR", "remarks": "r"}))["data"]
    assert claim["status"] == "Initiated" and claim["referenceId"]
    assert hrms.post(f"{V2}/claim/employees/{emp}/requests", json={"claimEventId": 999, "currencyId": "INR"}).json()["error"]["data"]["invalidParamKeys"] == ["claimEventId"]

    expense = {"expenseTypeId": kind, "date": date.today().isoformat(), "amount": "250.50", "note": "cab"}
    ok(hrms.post(f"{V2}/claim/requests/{claim['id']}/expenses", json=expense))
    assert hrms.post(f"{V2}/claim/requests/{claim['id']}/expenses", json={**expense, "amount": "-1"}).json()["error"]["data"]["invalidParamKeys"] == ["amount"]
    listed = ok(hrms.get(f"{V2}/claim/requests/{claim['id']}/expenses"))
    assert listed["data"][0]["amount"] == "250.50" and listed["meta"]["sum"] == "250.50"

    action = f"{V2}/claim/requests/{claim['id']}/action"
    assert hrms.put(action, json={"action": "APPROVE"}).status_code == 422  # not submitted yet
    assert ok(hrms.put(action, json={"action": "SUBMIT"}))["data"]["status"] == "Submitted"
    assert hrms.put(action, json={"action": "SUBMIT"}).status_code == 422
    assert hrms.post(f"{V2}/claim/requests/{claim['id']}/expenses", json=expense).status_code == 422  # locked after submit
    assert ok(hrms.put(action, json={"action": "APPROVE"}))["data"]["status"] == "Approved"
    assert ok(hrms.put(action, json={"action": "PAY"}))["data"]["status"] == "Paid"
    assert ok(hrms.get(f"{V2}/claim/employees/requests", params={"status": "Paid", "empNumber": emp}))["data"][0]["amount"] == "250.50"
    assert hrms.get(f"{V2}/claim/requests/12345").status_code == 404


# ------------------------------------------------------------------------------------ persistence
def test_data_survives_a_restart_and_seeding_runs_once(tmp_path):
    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        client.post(f"{PAGES}/auth/validate-json", json={"username": "Admin", "password": "admin123"})
        new_employee(client, "Keep", "Me")
        before = len(ok(client.get(f"{V2}/leave/holidays", params={"limit": 100}))["data"])
    with TestClient(create_app(settings)) as client:
        client.post(f"{PAGES}/auth/validate-json", json={"username": "Admin", "password": "admin123"})
        assert [e["firstName"] for e in ok(client.get(f"{V2}/pim/employees"))["data"]] == ["Keep"]
        assert len(ok(client.get(f"{V2}/leave/holidays", params={"limit": 100}))["data"]) == before


# --------------------------------------------------------------- the portal's real client, over HTTP
@pytest.fixture(scope="module")
def live(tmp_path_factory):
    """The portal on a real local port (a thread), so the real requests-based client can talk to it."""
    tmp = tmp_path_factory.mktemp("live")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    settings = _settings(tmp, hrms_enabled=True, hrms_base_url=f"http://127.0.0.1:{port}/api/hrms")
    server = uvicorn.Server(uvicorn.Config(create_app(settings), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "the local server did not start"
    yield settings, port
    server.should_exit = True
    thread.join(timeout=10)


def _candidate():
    from app.schemas.employee import Employee

    return Employee(id="AE-424242", full_name="Ritu Menon Nair", email="ritu@example.com", phone="+91 98765 43210", dob=date(1993, 3, 9), aadhaar="234567890123",
                    emergency_name="Anil Nair", emergency_phone="+91 98765 00000", address="12 Lake Road, Baner, Pune 411045", department="Data & AI",
                    job_title="Analyst", manager="Priya Iyer", start_date=date(2025, 1, 6), annual_ctc=1_800_000, hardware="Laptop")


def test_the_real_client_runs_every_call_against_the_replica(live):
    settings, port = live
    oh = OrangeHRMClient(settings)
    OrangeHRMClient._leave_session = None
    assert oh.check_connection() == "Authenticated"

    # PIM
    result = oh.create_employee_profile(_candidate(), "ritu.nair@corp.example", [("id.pdf", b"%PDF-1", "application/pdf")])
    assert result.warnings == [] and result.info.attached_documents == ["id.pdf"]
    emp = result.info.emp_number
    assert result.info.employee_id == "424242"
    assert result.info.profile_url == f"http://127.0.0.1:{port}/api/hrms/web/index.php/pim/viewPersonalDetails/empNumber/{emp}"
    assert oh.employee_exists(emp) and not oh.employee_exists(99999)
    assert oh.find_employee_number("Ritu Menon Nair") == emp
    assert "ritu menon nair" in oh.list_employee_names()
    again = oh.create_employee_profile(_candidate(), "ritu.nair@corp.example", [])  # same id and e-mail: the client's fall-backs
    assert again.info.emp_number != emp and again.notes

    # salary
    assert oh.salary_components(emp) == [{"name": "CTC", "amount": 1_800_000.0, "currency": "INR"}]

    # leave
    names = {t["name"]: t["id"] for t in oh.leave_types()}
    assert "Casual Leave" in names
    new_type = oh.create_leave_type("Volunteer Leave")
    assert new_type not in names.values()
    start, end = oh.leave_period(date.today())
    oh.add_entitlement(emp, names["Casual Leave"], 6, start, end)
    assert oh.leave_balances(emp) == [{"leaveTypeId": names["Casual Leave"], "leaveType": "Casual Leave", "entitled": 6.0, "used": 0.0, "pending": 0.0, "balance": 6.0}]
    assert any(h["name"] == "Republic Day" for h in oh.holidays(date(date.today().year, 1, 1), date(date.today().year, 12, 31)))
    week = oh.work_week()
    assert week["monday"] == 0 and week["sunday"] == 8
    monday = a_monday()
    assert oh.has_overlapping_leave(emp, monday, monday + timedelta(days=1)) is False
    booked = oh.assign_leave(emp, names["Casual Leave"], monday, monday + timedelta(days=1), "Family trip")
    assert booked["id"] and booked["url"].endswith(f"/leave/viewLeaveRequest/{booked['id']}")
    assert oh.has_overlapping_leave(emp, monday, monday) is True
    assert oh.leave_balances(emp)[0]["balance"] == 4.0
    assert oh.balance_report_url().endswith("/leave/viewLeaveBalanceReport") and oh.attendance_url().endswith("/attendance/viewAttendanceRecord")

    # attendance
    day = date.today()
    oh.punch_in(emp, day, "09:30", "in")
    oh.punch_out(emp, day, "18:15", "out")
    records = oh.attendance_records(emp, day, day)
    assert [(r["inDate"], r["inTime"], r["outDate"], r["outTime"]) for r in records] == [(day.isoformat(), "09:30", day.isoformat(), "18:15")]
    oh.delete_attendance_records(emp, [records[0]["id"]])
    assert oh.attendance_records(emp, day, day) == []

    # claim
    event, kind = oh.create_claim_event("Client Visit"), oh.create_claim_expense_type("Parking")
    assert {"id": event, "name": "Client Visit"} in oh.claim_events() and {"id": kind, "name": "Parking"} in oh.claim_expense_types()
    claim = oh.assign_claim(emp, event, "INR", "visit")
    oh.add_claim_expense(claim, kind, day, 120.5, "lot")
    oh.submit_claim(claim)
    assert oh.claim_url(claim).endswith(f"/claim/assignClaim/id/{claim}")

    # termination (by a stale number: the client finds the person by name)
    done = oh.terminate_employee(99999, "Ritu Menon Nair", day.isoformat(), "left")
    assert done["empNumber"] == emp and done["profileUrl"].endswith(f"/pim/viewPersonalDetails/empNumber/{emp}")
    past = oh._leave_call("GET", "pim/employees", params={"includeEmployees": "onlyPast"})["data"]
    assert [p["empNumber"] for p in past] == [emp] and past[0]["terminationId"]


def test_the_portal_health_check_reaches_the_replica_over_http_from_its_own_request(live):
    settings, port = live
    import requests

    body = requests.get(f"http://127.0.0.1:{port}/api/integrations/health", timeout=30).json()
    assert body["orangehrm"]["configured"] is True and body["orangehrm"]["ok"] is True


def test_the_ui_url_setting_changes_the_page_links(tmp_path):
    plain = OrangeHRMClient(Settings(_env_file=None, hrms_base_url="http://hrm.example/orangehrm/"))
    assert plain.balance_report_url() == "http://hrm.example/orangehrm/web/index.php/leave/viewLeaveBalanceReport"
    shown = OrangeHRMClient(Settings(_env_file=None, hrms_base_url="http://hrm.example/api/hrms", hrms_ui_url="http://localhost:3000/hr/simulated/hrms/"))
    assert shown.claim_url(5) == "http://localhost:3000/hr/simulated/hrms/claim/assignClaim/id/5"

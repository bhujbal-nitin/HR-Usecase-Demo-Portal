"""HRMS: the HRMS 5 replica. Same web-session login and /web/index.php/api/v2 JSON API a real HRMS offers.

Served under /api/hrms (so the base URL is http://<portal-host>/api/hrms). It has its own login cookie, so the portal's own sign-in
does not apply here. The endpoints are plain ``def`` functions: they run in worker threads, so the portal can call itself over HTTP.
"""

import base64
from datetime import date, datetime
from html import escape

from fastapi import APIRouter, Body, Depends, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from app.hrms import attendance, claim, leave, pim
from app.hrms.auth import COOKIE
from app.hrms.common import CURRENCIES, HrmsError, int_list, ok
from app.hrms.service import HrmsService

router = APIRouter(prefix="/hrms", tags=["hrms"])
PAGES = "/web/index.php"
API = f"{PAGES}/api/v2"
Body_ = Body(default=None)

_LOGIN_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>HRMS</title></head>
<body style="font-family:sans-serif;max-width:340px;margin:80px auto">
<h2>HRMS login</h2>
<div id="app"><oxd-login-page :token="&quot;{token}&quot;"></oxd-login-page></div>
<form method="post" action="{action}"><input type="hidden" name="_token" value="{token}">
<p><input name="username" placeholder="Username" style="width:100%;padding:6px"></p>
<p><input name="password" type="password" placeholder="Password" style="width:100%;padding:6px"></p>
<button type="submit">Login</button></form></body></html>"""


def _service(request: Request) -> HrmsService:
    svc: HrmsService = request.app.state.container.hrms
    svc.ensure_seeded()
    return svc


def _session(request: Request) -> HrmsService:
    """The service, for a request that carries a valid login cookie (otherwise 401 'Session expired', like HRMS)."""
    svc = _service(request)
    if svc.auth.username(request.cookies.get(COOKIE)) is None:
        raise HrmsError(401, "Session expired")
    return svc


def _prefix(request: Request) -> str:
    return request.url.path.split(PAGES)[0]


def _today() -> date:
    return date.today()


def _ids(body) -> list[int]:
    return int_list(body or {})


# ------------------------------------------------------------------------------------------- login
@router.get(f"{PAGES}/auth/login", response_class=HTMLResponse)
def login_page(request: Request, svc: HrmsService = Depends(_service)):
    return HTMLResponse(_LOGIN_PAGE.format(token=svc.auth.csrf_token(), action=escape(f"{_prefix(request)}{PAGES}/auth/validate")))


@router.post(f"{PAGES}/auth/validate")
def validate(request: Request, token: str = Form("", alias="_token"), username: str = Form(""), password: str = Form(""), svc: HrmsService = Depends(_service)):
    good = svc.auth.csrf_valid(token) and svc.auth.credentials_valid(username, password)
    response = RedirectResponse(f"{_prefix(request)}{PAGES}/{'dashboard/index' if good else 'auth/login'}", status_code=302)
    if good:
        response.set_cookie(COOKIE, svc.auth.session_cookie(), httponly=True, samesite="lax", max_age=svc.auth.max_age, path="/")
    return response


@router.post(f"{PAGES}/auth/validate-json")
def validate_json(body: dict | None = Body_, svc: HrmsService = Depends(_service)):
    body = body or {}
    if not svc.auth.credentials_valid(str(body.get("username", "")), str(body.get("password", ""))):
        return JSONResponse(HrmsError(401, "Invalid credentials").body(), status_code=401)
    response = JSONResponse(ok({"username": str(body["username"]).strip()}))
    response.set_cookie(COOKIE, svc.auth.session_cookie(), httponly=True, samesite="lax", max_age=svc.auth.max_age, path="/")
    return response


@router.post(f"{PAGES}/auth/logout")
def logout():
    response = JSONResponse(ok({}))
    response.delete_cookie(COOKIE, path="/")
    return response


@router.get(f"{PAGES}/dashboard/index", response_class=HTMLResponse)
def dashboard(request: Request, svc: HrmsService = Depends(_service)):
    if svc.auth.username(request.cookies.get(COOKIE)) is None:
        return RedirectResponse(f"{_prefix(request)}{PAGES}/auth/login", status_code=302)
    return HTMLResponse("<!doctype html><html><head><title>Dashboard</title></head><body>Dashboard</body></html>")


@router.get(f"{API}/auth/session")
def session_info(request: Request, svc: HrmsService = Depends(_session)):
    name = svc.auth.username(request.cookies.get(COOKIE)) or ""
    return ok({"username": name, "fullName": name})


# ------------------------------------------------------------------------------------------ lookups
@router.get(f"{API}/admin/currencies")
def currencies(svc: HrmsService = Depends(_session)):
    return ok([{"id": k, "name": v} for k, v in CURRENCIES.items()])


@router.get(f"{API}/admin/{{kind}}")
def lookups(kind: str, request: Request, svc: HrmsService = Depends(_session)):
    key = {"job-titles": "jobTitles", "subunits": "subunits", "employment-statuses": "empStatuses", "locations": "locations"}.get(kind)
    if key is None:
        raise HrmsError(404, f"Unknown resource '{kind}'")
    with svc.store.read() as s:
        return ok([{"id": i["id"], "name": i["name"], **({"title": i["name"], "isDeleted": False} if key == "jobTitles" else {})} for i in pim.lookup_list(s, key)])


# -------------------------------------------------------------------------------------------- PIM
@router.get(f"{API}/pim/employees")
def employees(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = pim.list_employees(s, request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/pim/employees")
def create_employee(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.create(s, body or {}))


@router.delete(f"{API}/pim/employees")
def delete_employees(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.delete(s, _ids(body)))


@router.get(f"{API}/pim/employees/{{emp}}")
def employee(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        found = pim.find(s, emp)
        return ok({**pim.row(s, found), **pim.personal(found), **pim.job(s, found), "fullName": pim.full_name(found)})


@router.get(f"{API}/pim/employees/{{emp}}/personal-details")
def personal_details(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(pim.personal(pim.find(s, emp)))


@router.put(f"{API}/pim/employees/{{emp}}/personal-details")
def save_personal(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.save_personal(s, pim.find(s, emp), body or {}))


@router.get(f"{API}/pim/employees/{{emp}}/job-details")
def job_details(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(pim.job(s, pim.find(s, emp)))


@router.put(f"{API}/pim/employees/{{emp}}/job-details")
def save_job(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.save_job(s, pim.find(s, emp), body or {}))


@router.get(f"{API}/pim/employee/{{emp}}/contact-details")  # sic: HRMS's contact-details path is singular
def contact_details(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(pim.find(s, emp)["contact"])


@router.put(f"{API}/pim/employee/{{emp}}/contact-details")
def save_contact(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.save_contact(s, pim.find(s, emp), body or {}))


@router.get(f"{API}/pim/employees/{{emp}}/emergency-contacts")
def emergency_contacts(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows = pim.find(s, emp)["emergency"]
    return ok(rows, total=len(rows))


@router.post(f"{API}/pim/employees/{{emp}}/emergency-contacts")
def add_emergency_contact(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.save_emergency(pim.find(s, emp), s, body or {}))


@router.get(f"{API}/pim/employees/{{emp}}/salary-components")
def salary_components(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows = pim.find(s, emp)["salary"]
    return ok(rows, total=len(rows))


@router.post(f"{API}/pim/employees/{{emp}}/salary-components")
def add_salary_component(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.add_salary(pim.find(s, emp), s, body or {}))


@router.get(f"{API}/pim/employees/{{emp}}/screen/personal/attachments")
def attachments(emp: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows = pim.attachment_list(pim.find(s, emp))
    return ok(rows, total=len(rows))


@router.post(f"{API}/pim/employees/{{emp}}/screen/personal/attachments")
def add_attachment(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.add_attachment(pim.find(s, emp), s, body or {}))


@router.get(f"{API}/pim/employees/{{emp}}/screen/personal/attachments/{{attachment}}")
def attachment_file(emp: str, attachment: int, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        item = pim.attachment_file(pim.find(s, emp), attachment)
    safe = item["filename"].replace('"', "")
    return Response(base64.b64decode(item["base64"]), media_type=item["fileType"], headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.get(f"{API}/pim/termination-reasons")
def termination_reasons(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(pim.reasons(s), total=len(pim.reasons(s)))


@router.post(f"{API}/pim/termination-reasons")
def add_termination_reason(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.add_reason(s, body or {}))


@router.post(f"{API}/pim/employees/{{emp}}/terminations")
def terminate(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(pim.terminate(s, pim.find(s, emp), body or {}))


@router.delete(f"{API}/pim/employees/{{emp}}/terminations")
def reinstate(emp: str, svc: HrmsService = Depends(_session)):
    """Extra (not in the contract's required set): bring a terminated employee back."""
    with svc.store.write() as s:
        pim.reinstate(s, pim.find(s, emp))
        return ok({"empNumber": int(emp)})


# ------------------------------------------------------------------------------------------ Leave
@router.get(f"{API}/leave/leave-types")
def leave_types(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows = leave.leave_types(s)
    return ok(rows, total=len(rows))


@router.post(f"{API}/leave/leave-types")
def add_leave_type(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.add_leave_type(s, body or {}))


@router.delete(f"{API}/leave/leave-types")
def delete_leave_types(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.delete_leave_types(s, _ids(body)))


@router.get(f"{API}/leave/leave-periods")
def leave_periods(svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(leave.periods(s, _today()))


@router.get(f"{API}/leave/leave-period")
def leave_period(svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(s["leavePeriod"])


@router.put(f"{API}/leave/leave-period")
def save_leave_period(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.save_leave_period(s, body or {}))


@router.get(f"{API}/leave/leave-entitlements")
def entitlements(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = leave.list_entitlements(s, request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/leave/leave-entitlements")
def add_entitlement(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.add_entitlement(s, body or {}))


@router.get(f"{API}/leave/employees/leave-balances")
def leave_balances(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = leave.balances(s, request.query_params, _today())
    return ok(rows, **meta)


@router.get(f"{API}/leave/holidays")
def holidays(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = leave.list_holidays(s, request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/leave/holidays")
def add_holiday(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.add_holiday(s, body or {}))


@router.delete(f"{API}/leave/holidays")
def delete_holidays(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.delete_holidays(s, _ids(body)))


@router.get(f"{API}/leave/workweek")
def work_week(svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        return ok(leave.work_week(s))


@router.put(f"{API}/leave/workweek")
def save_work_week(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.save_work_week(s, body or {}))


@router.get(f"{API}/leave/overlap-leaves")
def overlap_leaves(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        hits = leave.overlapping(s, request.query_params)
    # HRMS answers with the work-shift check (and no overlaps) when nothing overlaps
    return {"data": hits, "meta": {} if hits else {"isWorkShiftLengthExceeded": True}}


@router.post(f"{API}/leave/employees/leave-requests")
def assign_leave(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.create_request(s, body or {}, _today(), datetime.now().isoformat(timespec="seconds")))


@router.put(f"{API}/leave/employees/leave-requests/{{request_id}}")
def cancel_leave_put(request_id: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(leave.cancel_request(s, request_id, body or {}, _today()))


@router.put(f"{API}/leave/leave-requests/{{request_id}}")
def cancel_leave_alias(request_id: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    return cancel_leave_put(request_id, body, svc)


@router.get(f"{API}/leave/leave-requests")
def leave_requests(request: Request, svc: HrmsService = Depends(_session)):
    lists = {"statuses": request.query_params.getlist("statuses[]") + request.query_params.getlist("statuses")}
    with svc.store.read() as s:
        rows, meta = leave.list_requests(s, request.query_params, lists, _today())
    return ok(rows, **meta)


@router.get(f"{API}/leave/leave-requests/{{request_id}}")
def leave_request(request_id: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        found = leave.find_request(s, request_id)
        return ok({**leave.request_row(s, found, _today()), "days": leave.request_days(s, found, _today())})


# -------------------------------------------------------------------------------------- Attendance
@router.get(f"{API}/attendance/employees/summary")
def attendance_summary(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = attendance.summary(s, request.query_params, _today())
    return ok(rows, **meta)


@router.get(f"{API}/attendance/employees/{{emp}}/records")
def attendance_records(emp: str, request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = attendance.list_records(s, emp, request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/attendance/employees/{{emp}}/records")
def punch_in(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(attendance.punch_in(s, emp, body or {}))


@router.put(f"{API}/attendance/employees/{{emp}}/records")
def punch_out(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(attendance.punch_out(s, emp, body or {}))


@router.delete(f"{API}/attendance/employees/{{emp}}/records")
def delete_attendance(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(attendance.delete_records(s, emp, _ids(body)))


# -------------------------------------------------------------------------------------------- Claim
@router.get(f"{API}/claim/events")
def claim_events(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = claim.setup_list(s, "claimEvents", request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/claim/events")
def add_claim_event(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.add_setup(s, "claimEvents", body or {}))


@router.delete(f"{API}/claim/events")
def delete_claim_events(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.delete_setup(s, "claimEvents", _ids(body)))


@router.get(f"{API}/claim/expenses/types")
def expense_types(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = claim.setup_list(s, "expenseTypes", request.query_params)
    return ok(rows, **meta)


@router.post(f"{API}/claim/expenses/types")
def add_expense_type(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.add_setup(s, "expenseTypes", body or {}))


@router.delete(f"{API}/claim/expenses/types")
def delete_expense_types(body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.delete_setup(s, "expenseTypes", _ids(body)))


@router.post(f"{API}/claim/employees/{{emp}}/requests")
def assign_claim(emp: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.create(s, emp, body or {}, _today()))


@router.get(f"{API}/claim/employees/requests")
def claims(request: Request, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        rows, meta = claim.list_claims(s, request.query_params)
    return ok(rows, **meta)


@router.get(f"{API}/claim/requests/{{claim_id}}")
def claim_request(claim_id: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        found = claim.find(s, claim_id)
        return ok({**claim.row(s, found), "expenses": [claim.expense_row(s, e) for e in found["expenses"]]})


@router.get(f"{API}/claim/requests/{{claim_id}}/expenses")
def claim_expenses(claim_id: str, svc: HrmsService = Depends(_session)):
    with svc.store.read() as s:
        found = claim.find(s, claim_id)
        rows = [claim.expense_row(s, e) for e in found["expenses"]]
        return ok(rows, total=len(rows), sum=f"{claim.total(found):.2f}")


@router.post(f"{API}/claim/requests/{{claim_id}}/expenses")
def add_claim_expense(claim_id: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.add_expense(s, claim_id, body or {}))


@router.delete(f"{API}/claim/requests/{{claim_id}}/expenses")
def delete_claim_expenses(claim_id: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.delete_expenses(s, claim_id, _ids(body)))


@router.put(f"{API}/claim/requests/{{claim_id}}/action")
def claim_action(claim_id: str, body: dict | None = Body_, svc: HrmsService = Depends(_session)):
    with svc.store.write() as s:
        return ok(claim.act(s, claim_id, body or {}, _today()))

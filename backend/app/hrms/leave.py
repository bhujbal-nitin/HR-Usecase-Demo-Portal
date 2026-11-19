"""Leave: types, leave period, entitlements, holidays, work week, requests (assigned leave) and balances."""

from datetime import date, timedelta

from app.hrms import pim
from app.hrms.common import HrmsError, invalid, next_id, not_found, paged, text, to_date, to_int

_DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_HALF_DAY = {"half_day", "half_day_morning", "half_day_afternoon"}
_INACTIVE = {"Cancelled", "Rejected"}
DEFAULT_WORK_WEEK = {"monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0, "friday": 0, "saturday": 8, "sunday": 8}  # 0 work, 4 half, 8 off


# ------------------------------------------------------------------------------------- set-up
def leave_types(state: dict) -> list[dict]:
    return [t for t in state["leaveTypes"] if not t["deleted"]]


def add_leave_type(state: dict, body: dict) -> dict:
    name = text(body, "name", required=True, max_len=50)
    if any(t["name"].lower() == name.lower() for t in leave_types(state)):
        raise invalid("name", message="Already exists")
    item = {"id": next_id(state, "leaveType"), "name": name, "deleted": False, "situational": bool(body.get("situational"))}
    state["leaveTypes"].append(item)
    return item


def delete_leave_types(state: dict, ids: list[int]) -> list[int]:
    gone = [t for t in leave_types(state) if t["id"] in ids]
    for item in gone:
        item["deleted"] = True
    return [t["id"] for t in gone]


def _type(state: dict, type_id, key: str = "leaveTypeId") -> dict:
    found = next((t for t in leave_types(state) if t["id"] == to_int(type_id)), None)
    if found is None:
        raise invalid(key, message="Leave type not found")
    return found


def period_for(state: dict, day: date) -> tuple[date, date]:
    setting = state["leavePeriod"]
    start = date(day.year, setting["startMonth"], setting["startDay"])
    if day < start:
        start = date(day.year - 1, setting["startMonth"], setting["startDay"])
    return start, date(start.year + 1, setting["startMonth"], setting["startDay"]) - timedelta(days=1)


def periods(state: dict, today: date) -> list[dict]:
    result = []
    for year in (today.year - 1, today.year, today.year + 1):
        start, end = period_for(state, date(year, 12, 31))
        result.append({"startDate": start.isoformat(), "endDate": end.isoformat()})
    return sorted({p["startDate"]: p for p in result}.values(), key=lambda p: p["startDate"])


def save_leave_period(state: dict, body: dict) -> dict:
    month, day = to_int(body.get("startMonth")), to_int(body.get("startDay"))
    try:
        date(2024, month or 0, day or 0)
    except ValueError:
        raise invalid("startMonth", "startDay") from None
    state["leavePeriod"] = {"startMonth": month, "startDay": day}
    return state["leavePeriod"]


def work_week(state: dict) -> dict:
    return {day: state["workWeek"].get(day, 0) for day in _DAYS}


def save_work_week(state: dict, body: dict) -> dict:
    new = dict(work_week(state))
    for day in _DAYS:
        if day in body:
            if to_int(body[day]) not in (0, 4, 8):
                raise invalid(day)
            new[day] = to_int(body[day])
    state["workWeek"] = new
    return new


def add_holiday(state: dict, body: dict) -> dict:
    day = to_date(body.get("date"), "date")
    length = to_int(body.get("length"), 0)
    if length not in (0, 4):
        raise invalid("length")
    if any(h["date"] == day.isoformat() for h in state["holidays"]):
        raise invalid("date", message="A holiday already exists on this date")
    item = {"id": next_id(state, "holiday"), "name": text(body, "name", required=True, max_len=200), "date": day.isoformat(), "length": length, "recurring": bool(body.get("recurring"))}
    state["holidays"].append(item)
    return item


def list_holidays(state: dict, params) -> tuple[list[dict], dict]:
    start, end = params.get("fromDate") or "0000-01-01", params.get("toDate") or "9999-12-31"
    rows = sorted((h for h in state["holidays"] if start <= h["date"] <= end), key=lambda h: h["date"])
    return paged(rows, params)


def delete_holidays(state: dict, ids: list[int]) -> list[int]:
    gone = [h["id"] for h in state["holidays"] if h["id"] in ids]
    state["holidays"] = [h for h in state["holidays"] if h["id"] not in gone]
    return gone


# --------------------------------------------------------------------------------- entitlements
def entitlement_row(state: dict, item: dict) -> dict:
    kind = next((t for t in state["leaveTypes"] if t["id"] == item["leaveTypeId"]), {"id": item["leaveTypeId"], "name": ""})
    return {"id": item["id"], "empNumber": item["empNumber"], "leaveType": {"id": kind["id"], "name": kind["name"]},
            "fromDate": item["fromDate"], "toDate": item["toDate"], "noOfDays": item["noOfDays"]}


def add_entitlement(state: dict, body: dict) -> dict:
    emp = pim.active(state, body.get("empNumber"))
    kind = _type(state, body.get("leaveTypeId"))
    start, end = to_date(body.get("fromDate"), "fromDate"), to_date(body.get("toDate"), "toDate")
    if end < start:
        raise invalid("toDate", message="To date should be after from date")
    try:
        days = round(float(body.get("entitlement")), 2)
    except (TypeError, ValueError):
        raise invalid("entitlement") from None
    if not 0 < days <= 365:
        raise invalid("entitlement", message="Should be between 0 and 365")
    for item in state["entitlements"]:
        if (item["empNumber"], item["leaveTypeId"], item["fromDate"], item["toDate"]) == (emp["empNumber"], kind["id"], start.isoformat(), end.isoformat()):
            item["noOfDays"] = round(item["noOfDays"] + days, 2)  # HRMS adds to the matching entitlement
            return entitlement_row(state, item)
    item = {"id": next_id(state, "entitlement"), "empNumber": emp["empNumber"], "leaveTypeId": kind["id"], "fromDate": start.isoformat(), "toDate": end.isoformat(), "noOfDays": days}
    state["entitlements"].append(item)
    return entitlement_row(state, item)


def list_entitlements(state: dict, params) -> tuple[list[dict], dict]:
    emp, kind = to_int(params.get("empNumber")), to_int(params.get("leaveTypeId"))
    start, end = params.get("fromDate") or "0000-01-01", params.get("toDate") or "9999-12-31"
    rows = [i for i in state["entitlements"] if (emp is None or i["empNumber"] == emp) and (kind is None or i["leaveTypeId"] == kind)
            and i["fromDate"] >= start and i["toDate"] <= end]
    page, meta = paged(rows, params)
    return [entitlement_row(state, i) for i in page], meta


# ----------------------------------------------------------------------------------- requests
def day_status(day: dict, today: date) -> str:
    """Assigned leave is Scheduled until its day has come, then Taken."""
    return "Taken" if day["status"] == "Scheduled" and day["date"] <= today.isoformat() else day["status"]


def _usage(state: dict, emp_number: int, type_id: int, start: date, end: date, today: date) -> dict:
    totals = {"Taken": 0.0, "Scheduled": 0.0, "Pending Approval": 0.0}
    for request in state["leaveRequests"]:
        if request["empNumber"] == emp_number and request["leaveTypeId"] == type_id:
            for day in request["days"]:
                if start.isoformat() <= day["date"] <= end.isoformat() and day_status(day, today) in totals:
                    totals[day_status(day, today)] += day["length"]
    entitled = sum(i["noOfDays"] for i in state["entitlements"] if (i["empNumber"], i["leaveTypeId"]) == (emp_number, type_id)
                   and i["fromDate"] <= end.isoformat() and i["toDate"] >= start.isoformat())
    used, scheduled, pending = totals["Taken"], totals["Scheduled"], totals["Pending Approval"]
    return {"entitled": entitled, "used": used, "taken": used, "scheduled": scheduled, "pending": pending, "balance": round(entitled - used - scheduled - pending, 2)}


def balances(state: dict, params, today: date) -> tuple[list[dict], dict]:
    emp = pim.find(state, params.get("empNumber"))
    day = to_date(params.get("date") or today.isoformat(), "date")
    start, end = period_for(state, day)
    rows = []
    for kind in leave_types(state):
        has_entitlement = any((i["empNumber"], i["leaveTypeId"]) == (emp["empNumber"], kind["id"]) and i["fromDate"] <= end.isoformat() and i["toDate"] >= start.isoformat()
                              for i in state["entitlements"])
        rows.append({"leaveType": {"id": kind["id"], "name": kind["name"]},
                     "usageBreakdown": _usage(state, emp["empNumber"], kind["id"], start, end, today) if has_entitlement else None})
    return rows, {"total": len(rows)}


def _day_length(state: dict, day: date) -> float:
    """How much of this day counts as leave: 0 for a day off (weekend / full holiday), 0.5 for a half day, else 1."""
    mode = work_week(state)[_DAYS[day.weekday()]]
    length = 0.0 if mode == 8 else 0.5 if mode == 4 else 1.0
    holiday = next((h for h in state["holidays"] if h["date"] == day.isoformat()), None)
    if holiday:
        length = 0.0 if holiday["length"] == 0 else min(length, 0.5)
    return length


def _active_length(state: dict, emp_number: int, day: str, skip_request: int | None = None) -> float:
    return sum(d["length"] for r in state["leaveRequests"] if r["empNumber"] == emp_number and r["id"] != skip_request
               for d in r["days"] if d["date"] == day and d["status"] not in _INACTIVE)


def _duration(body: dict) -> str:
    kind = (body.get("duration") or {}).get("type") if isinstance(body.get("duration"), dict) else None
    if kind not in {"full_day", *_HALF_DAY}:
        raise invalid("duration", message="Supported durations: full_day, half_day_morning, half_day_afternoon")
    return kind


def request_row(state: dict, request: dict, today: date) -> dict:
    emp = next((e for e in state["employees"] if e["empNumber"] == request["empNumber"]), None)
    kind = next((t for t in state["leaveTypes"] if t["id"] == request["leaveTypeId"]), {"id": request["leaveTypeId"], "name": ""})
    statuses: dict[str, float] = {}
    for day in request["days"]:
        statuses[day_status(day, today)] = statuses.get(day_status(day, today), 0.0) + day["length"]
    live = {k: v for k, v in statuses.items() if k not in _INACTIVE} or statuses
    return {
        "id": request["id"], "leaveType": {"id": kind["id"], "name": kind["name"]}, "empNumber": request["empNumber"],
        "firstName": emp["firstName"] if emp else "", "lastName": emp["lastName"] if emp else "",
        "dates": {"fromDate": request["fromDate"], "toDate": request["toDate"]}, "noOfDays": round(sum(live.values()), 2),
        "leaveBreakdown": ", ".join(f"{v:.2f} {k}" for k, v in statuses.items()),
        "status": max(live, key=live.get) if live else "Cancelled", "comment": request["comment"], "createdAt": request["createdAt"],
    }


def create_request(state: dict, body: dict, today: date, now_iso: str) -> dict:
    emp = pim.active(state, body.get("empNumber"))
    kind = _type(state, body.get("leaveTypeId"))
    start, end = to_date(body.get("fromDate"), "fromDate"), to_date(body.get("toDate"), "toDate")
    if end < start:
        raise invalid("toDate", message="To date should be after from date")
    if (end - start).days > 366:
        raise invalid("toDate", message="A leave request can cover at most a year")
    duration = _duration(body)
    if duration in _HALF_DAY and start != end:
        raise invalid("duration", message="A half day applies to a single day")
    days = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        length = _day_length(state, day)
        if length and duration in _HALF_DAY:
            length = 0.5
        if length:
            days.append({"date": day.isoformat(), "length": length, "status": "Scheduled"})
    if not days:
        raise HrmsError(422, "Failed to Submit: No Working Days Selected")
    for day in days:
        if _active_length(state, emp["empNumber"], day["date"]) + day["length"] > 1:
            raise HrmsError(422, "Failed to Submit: Overlapping Leave Request Found")
    needed: dict[date, float] = {}
    for day in days:
        first = period_for(state, date.fromisoformat(day["date"]))[0]
        needed[first] = needed.get(first, 0.0) + day["length"]
    for first, count in needed.items():
        _, last = period_for(state, first)
        if count > _usage(state, emp["empNumber"], kind["id"], first, last, today)["balance"]:
            raise HrmsError(422, "Failed to Submit: Leave Balance Exceeded")
    request = {"id": next_id(state, "leaveRequest"), "empNumber": emp["empNumber"], "leaveTypeId": kind["id"], "fromDate": start.isoformat(),
               "toDate": end.isoformat(), "comment": text(body, "comment", max_len=250), "createdAt": now_iso, "days": days}
    state["leaveRequests"].append(request)
    return request_row(state, request, today)


def overlapping(state: dict, params) -> list[dict]:
    """The employee's existing leave in the period (each request once), for a leave of the asked duration."""
    emp = pim.find(state, params.get("empNumber"))
    start, end = to_date(params.get("fromDate"), "fromDate"), to_date(params.get("toDate"), "toDate")
    length = 0.5 if params.get("duration[type]") in _HALF_DAY else 1.0
    hits = {}
    for offset in range((end - start).days + 1):
        day = (start + timedelta(days=offset)).isoformat()
        existing = _active_length(state, emp["empNumber"], day)
        if existing and existing + length > 1:
            for request in state["leaveRequests"]:
                if request["empNumber"] == emp["empNumber"] and any(d["date"] == day and d["status"] not in _INACTIVE for d in request["days"]):
                    hits[request["id"]] = {"id": request["id"], "date": day, "fromDate": request["fromDate"], "toDate": request["toDate"]}
    return list(hits.values())


def find_request(state: dict, request_id) -> dict:
    found = next((r for r in state["leaveRequests"] if r["id"] == to_int(request_id)), None)
    if found is None:
        raise not_found(f"Leave request with id '{request_id}' not found")
    return found


def list_requests(state: dict, params, query_lists: dict, today: date) -> tuple[list[dict], dict]:
    start, end = params.get("fromDate") or "0000-01-01", params.get("toDate") or "9999-12-31"
    emp, kind = to_int(params.get("empNumber")), to_int(params.get("leaveTypeId"))
    wanted = {s.lower() for s in query_lists.get("statuses", [])}
    rows = []
    for request in sorted(state["leaveRequests"], key=lambda r: (r["fromDate"], r["id"]), reverse=True):
        if (emp is not None and request["empNumber"] != emp) or (kind is not None and request["leaveTypeId"] != kind):
            continue
        if request["toDate"] < start or request["fromDate"] > end:
            continue
        if wanted and not any(day_status(d, today).lower() in wanted for d in request["days"]):
            continue
        rows.append(request)
    page, meta = paged(rows, params)
    return [request_row(state, r, today) for r in page], meta


def cancel_request(state: dict, request_id, body: dict, today: date) -> dict:
    request = find_request(state, request_id)
    if str(body.get("action", "")).upper() != "CANCEL":
        raise invalid("action", message="Only CANCEL is supported")
    live = [d for d in request["days"] if d["status"] not in _INACTIVE]
    if not live:
        raise HrmsError(422, "The leave request is already cancelled")
    for day in live:
        day["status"] = "Cancelled"
    return request_row(state, request, today)


def request_days(state: dict, request: dict, today: date) -> list[dict]:
    return [{"date": d["date"], "length": d["length"], "status": day_status(d, today)} for d in request["days"]]


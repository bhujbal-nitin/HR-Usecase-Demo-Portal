"""Attendance: punch in / punch out records per employee."""

from datetime import date, datetime, timedelta

from app.hrms import pim
from app.hrms.common import HrmsError, invalid, next_id, paged, text, to_clock, to_date


def _when(punch: dict) -> datetime:
    return datetime.fromisoformat(f"{punch['date']}T{punch['time']}")


def _side(punch: dict | None) -> dict | None:
    if punch is None:
        return None
    utc = _when(punch) - timedelta(hours=punch["offset"])
    name = punch["timezoneName"]
    return {
        "userDate": punch["date"], "userTime": punch["time"], "utcDate": utc.date().isoformat(), "utcTime": utc.strftime("%H:%M"),
        "offset": f"{punch['offset']:g}", "timezone": {"id": name, "label": f"(GMT{punch['offset']:+g}) {name}", "name": name}, "note": punch["note"],
    }


def hours(record: dict) -> float:
    if record["out"] is None:
        return 0.0
    return round((_when(record["out"]) - _when(record["in"])).total_seconds() / 3600, 2)


def row(record: dict) -> dict:
    state = "PUNCHED OUT" if record["out"] else "PUNCHED IN"
    return {"id": record["id"], "punchIn": _side(record["in"]), "punchOut": _side(record["out"]), "state": {"id": state, "name": state.title()}, "total": hours(record)}


def _punch(body: dict) -> dict:
    try:
        offset = float(body.get("timezoneOffset", 0) or 0)
    except (TypeError, ValueError):
        raise invalid("timezoneOffset") from None
    if not -14 <= offset <= 14:
        raise invalid("timezoneOffset")
    return {"date": to_date(body.get("date"), "date").isoformat(), "time": to_clock(body.get("time"), "time"), "offset": offset,
            "timezoneName": text(body, "timezoneName", max_len=100) or "UTC", "note": text(body, "note", max_len=250)}


def _records(state: dict, emp_number: int) -> list[dict]:
    return sorted((r for r in state["attendance"] if r["empNumber"] == emp_number), key=lambda r: (_when(r["in"]), r["id"]))


def list_records(state: dict, emp_number, params) -> tuple[list[dict], dict]:
    emp = pim.find(state, emp_number)
    start, end = params.get("fromDate") or "0000-01-01", params.get("toDate") or "9999-12-31"
    rows = [r for r in _records(state, emp["empNumber"]) if start <= r["in"]["date"] <= end]
    page, meta = paged(rows, params)
    return [row(r) for r in page], meta


def punch_in(state: dict, emp_number, body: dict) -> dict:
    emp = pim.active(state, emp_number)
    punch = _punch(body)
    records = _records(state, emp["empNumber"])
    if any(r["out"] is None for r in records):
        raise HrmsError(422, "Cannot Proceed Punch In Employee Already Punched In")
    moment = _when(punch)
    if any(_when(r["in"]) <= moment < _when(r["out"]) for r in records):
        raise HrmsError(422, "Overlapping Records Found")
    record = {"id": next_id(state, "attendance"), "empNumber": emp["empNumber"], "in": punch, "out": None}
    state["attendance"].append(record)
    return row(record)


def punch_out(state: dict, emp_number, body: dict) -> dict:
    emp = pim.active(state, emp_number)
    punch = _punch(body)
    open_records = [r for r in _records(state, emp["empNumber"]) if r["out"] is None]
    if not open_records:
        raise HrmsError(422, "Cannot Proceed Punch Out Employee Already Punched Out")
    record = open_records[-1]
    if _when(punch) <= _when(record["in"]):
        raise HrmsError(422, "Punch Out Time Should Be Later Than Punch In Time", ["time"])
    later = [r for r in _records(state, emp["empNumber"]) if r is not record and _when(record["in"]) < _when(r["in"]) < _when(punch)]
    if later:
        raise HrmsError(422, "Overlapping Records Found")
    record["out"] = punch
    return row(record)


def delete_records(state: dict, emp_number, ids: list[int]) -> list[int]:
    emp = pim.find(state, emp_number)
    gone = [r["id"] for r in state["attendance"] if r["empNumber"] == emp["empNumber"] and r["id"] in ids]
    state["attendance"] = [r for r in state["attendance"] if r["id"] not in gone]
    return gone


def summary(state: dict, params, today: date) -> tuple[list[dict], dict]:
    start, end = params.get("fromDate") or today.isoformat(), params.get("toDate") or today.isoformat()
    needle = " ".join(str(params.get("nameOrId", "")).lower().split())
    rows = []
    for emp in state["employees"]:
        if emp["terminationId"] or (needle and needle not in pim.full_name(emp).lower() and needle not in emp["employeeId"].lower()):
            continue
        total = sum(hours(r) for r in state["attendance"] if r["empNumber"] == emp["empNumber"] and start <= r["in"]["date"] <= end)
        rows.append({**pim.short(emp), "total": round(total, 2), "totalTime": f"{int(total)}:{round(total % 1 * 60):02d}"})
    page, meta = paged(rows, params)
    return page, meta

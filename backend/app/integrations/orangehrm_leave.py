"""OrangeHRM 5.x leave and attendance calls (the same web-session /api/v2 API the OrangeHRM screens use).

Mixed into ``OrangeHRMClient``; it relies on that class for ``_login``, ``_request``, ``base_url`` and ``_find_emp_number``.
Paths and field names follow the OrangeHRM 5 source (orangehrmLeavePlugin / orangehrmAttendancePlugin).
"""

import threading
import time
from datetime import date

import requests

from app.core.exceptions import IntegrationError

SYSTEM = "OrangeHRM"
_SESSION_TTL_SECONDS = 300  # reuse one web login for a few minutes instead of logging in for every call
_CONNECT_TIMEOUT_SECONDS = 5  # an unreachable OrangeHRM should fail in seconds, not minutes (the demo waits on it)


def _number(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_list(data) -> list[dict]:
    return data if isinstance(data, list) else []


class LeaveAttendanceMixin:
    _leave_session: requests.Session | None = None
    _leave_session_at: float = 0.0
    _leave_lock = threading.Lock()

    # ----------------------------------------------------------------- plumbing
    def _leave_call(self, method: str, path: str, **kwargs) -> dict:
        """The whole JSON answer (data and meta). Reuses a recent login; logs in again once if the session was dropped."""
        for attempt in (1, 2):
            with self._leave_lock:
                if self._leave_session is None or time.time() - self._leave_session_at > _SESSION_TTL_SECONDS:
                    self._leave_session, self._leave_session_at = self._login(_CONNECT_TIMEOUT_SECONDS), time.time()
                session = self._leave_session
            try:
                return self._request(session, method, path, **kwargs)
            except IntegrationError as exc:
                if attempt == 2 or ("401" not in exc.message and "Session expired" not in exc.message):
                    raise
                with self._leave_lock:
                    self._leave_session = None
        return {}

    def find_employee_number(self, full_name: str) -> int:
        """The OrangeHRM empNumber of a person known only by name (when onboarding did not record it)."""
        return self._find_emp_number(self._login(), full_name)

    # -------------------------------------------------------------------- leave
    def leave_types(self) -> list[dict]:
        """[{id, name}] for every leave type that is not deleted."""
        data = self._leave_call("GET", "leave/leave-types", params={"limit": 100}).get("data")
        return [{"id": t["id"], "name": t["name"]} for t in _as_list(data) if not t.get("deleted")]

    def create_leave_type(self, name: str) -> int:
        """Create a leave type (OrangeHRM refuses a name that already exists) and return its id."""
        body = self._leave_call("POST", "leave/leave-types", json={"name": name, "situational": False})
        leave_type_id = (body.get("data") or {}).get("id")
        if not leave_type_id:
            raise IntegrationError(SYSTEM, f"OrangeHRM did not return an id for the new leave type '{name}'.")
        return leave_type_id

    def leave_period(self, day: date) -> tuple[date, date]:
        """The leave period that contains ``day`` (OrangeHRM's leave-period setting); the calendar year if it does not say."""
        try:
            for period in _as_list(self._leave_call("GET", "leave/leave-periods").get("data")):
                start, end = date.fromisoformat(str(period["startDate"])[:10]), date.fromisoformat(str(period["endDate"])[:10])
                if start <= day <= end:
                    return start, end
        except (IntegrationError, KeyError, ValueError):
            pass
        return date(day.year, 1, 1), date(day.year, 12, 31)

    def add_entitlement(self, emp_number: int, leave_type_id: int, days: float, start: date, end: date) -> dict:
        """Give the employee a leave quota for a leave period."""
        payload = {"empNumber": emp_number, "leaveTypeId": leave_type_id, "fromDate": start.isoformat(), "toDate": end.isoformat(), "entitlement": days}
        return self._leave_call("POST", "leave/leave-entitlements", json=payload).get("data") or {}

    def leave_balances(self, emp_number: int) -> list[dict]:
        """One entry per leave type the employee has an entitlement for: entitled, used, pending, balance (days)."""
        body = self._leave_call("GET", "leave/employees/leave-balances", params={"empNumber": emp_number, "limit": 100})
        result = []
        for item in _as_list(body.get("data")):
            usage = item.get("usageBreakdown")
            leave_type = item.get("leaveType") or {}
            if not usage or "id" not in leave_type:
                continue  # no entitlement for this type in the period
            result.append({
                "leaveTypeId": leave_type["id"], "leaveType": leave_type.get("name", ""),
                "entitled": _number(usage.get("entitled", usage.get("entitlement"))), "used": _number(usage.get("used")),
                "pending": _number(usage.get("pending")), "balance": _number(usage.get("balance")),
            })
        return result

    def holidays(self, start: date, end: date) -> list[dict]:
        """[{name, date (YYYY-MM-DD), length}] in the period; length 0 is a full-day holiday, 4 a half day."""
        data = self._leave_call("GET", "leave/holidays", params={"fromDate": start.isoformat(), "toDate": end.isoformat(), "limit": 100}).get("data")
        return [
            {"name": h.get("name", "Holiday"), "date": str(h["date"])[:10], "length": int(_number(h.get("length")))}
            for h in _as_list(data) if h.get("date")
        ]

    def work_week(self) -> dict[str, int]:
        """{monday: 0, ...}; 0 working day, 4 half day, 8 non-working day. Empty if OrangeHRM does not say."""
        data = self._leave_call("GET", "leave/workweek").get("data")
        days = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
        return {day: int(_number(data[day])) for day in days if isinstance(data, dict) and day in data}

    def has_overlapping_leave(self, emp_number: int, start: date, end: date) -> bool:
        """True if the employee already has leave in the period."""
        body = self._leave_call("GET", "leave/overlap-leaves", params={
            "empNumber": emp_number, "fromDate": start.isoformat(), "toDate": end.isoformat(), "duration[type]": "full_day",
        })
        if (body.get("meta") or {}).get("isWorkShiftLengthExceeded"):
            return False  # OrangeHRM answers with the shift-length list instead when nothing overlaps
        return bool(_as_list(body.get("data")))

    def assign_leave(self, emp_number: int, leave_type_id: int, start: date, end: date, comment: str) -> dict:
        """Book approved leave for the employee (OrangeHRM's 'Assign Leave'). Returns {id, url}."""
        payload = {
            "empNumber": emp_number, "leaveTypeId": leave_type_id, "fromDate": start.isoformat(), "toDate": end.isoformat(),
            "comment": comment[:250], "duration": {"type": "full_day"},
        }
        try:
            body = self._leave_call("POST", "leave/employees/leave-requests", json=payload)
        except IntegrationError as exc:
            if "partialOption" not in exc.message:
                raise
            body = self._leave_call("POST", "leave/employees/leave-requests", json={**payload, "partialOption": "none"})
        leave_id = (body.get("data") or {}).get("id")
        return {"id": leave_id, "url": f"{self.base_url}/web/index.php/leave/viewLeaveRequest/{leave_id}" if leave_id else None}

    # --------------------------------------------------------------- attendance
    def attendance_records(self, emp_number: int, start: date, end: date) -> list[dict]:
        """[{id, inDate, inTime, outDate, outTime}] (the out fields are None while the employee is still punched in)."""
        data = self._leave_call("GET", f"attendance/employees/{emp_number}/records", params={
            "fromDate": start.isoformat(), "toDate": end.isoformat(), "limit": 100,
        }).get("data")
        records = []
        for item in _as_list(data):
            punch_in, punch_out = item.get("punchIn") or {}, item.get("punchOut") or {}
            records.append({
                "id": item.get("id"), "inDate": punch_in.get("userDate"), "inTime": str(punch_in.get("userTime") or "")[:5] or None,
                "outDate": punch_out.get("userDate") or None, "outTime": str(punch_out.get("userTime") or "")[:5] or None,
            })
        return records

    def _punch_body(self, day: date, clock: str, note: str) -> dict:
        return {
            "date": day.isoformat(), "time": clock, "timezoneOffset": self._s.orangehrm_timezone_offset,
            "timezoneName": self._s.orangehrm_timezone_name, "note": note[:250],
        }

    def punch_in(self, emp_number: int, day: date, clock: str, note: str) -> dict:
        """Add a punch-in for the employee (the day then has no out-punch until one is added)."""
        return self._leave_call("POST", f"attendance/employees/{emp_number}/records", json=self._punch_body(day, clock, note)).get("data") or {}

    def punch_out(self, emp_number: int, day: date, clock: str, note: str) -> dict:
        """Punch the employee out. OrangeHRM closes the employee's latest open record."""
        return self._leave_call("PUT", f"attendance/employees/{emp_number}/records", json=self._punch_body(day, clock, note)).get("data") or {}

    def delete_attendance_records(self, emp_number: int, record_ids: list[int]) -> None:
        """Delete the employee's attendance records with these ids (Time -> Attendance -> Employee Records -> Delete)."""
        if record_ids:
            self._leave_call("DELETE", f"attendance/employees/{emp_number}/records", json={"ids": record_ids})

    def attendance_url(self) -> str:
        return f"{self.base_url}/web/index.php/attendance/viewAttendanceRecord"

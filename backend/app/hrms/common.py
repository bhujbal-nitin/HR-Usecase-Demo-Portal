"""Small helpers shared by the HRMS modules: errors in HRMS's shape, id counters, input parsing, paging."""

import re
from datetime import date

CURRENCIES = {"INR": "Indian Rupee", "USD": "United States Dollar", "EUR": "Euro", "GBP": "Pound Sterling", "AED": "UAE Dirham", "SGD": "Singapore Dollar"}


class HrmsError(Exception):
    """An error answered in HRMS's format: {"error": {"status", "message", "data": {"invalidParamKeys"}}}."""

    def __init__(self, status: int, message: str, keys: list[str] | None = None):
        super().__init__(message)
        self.status, self.message, self.keys = status, message, keys or []

    def body(self) -> dict:
        error: dict = {"status": str(self.status), "message": self.message}
        if self.keys:
            error["data"] = {"invalidParamKeys": self.keys}
        return {"error": error}


def invalid(*keys: str, message: str = "Invalid Parameter") -> HrmsError:
    return HrmsError(422, message, list(keys))


def not_found(message: str) -> HrmsError:
    return HrmsError(404, message)


def ok(data, **meta) -> dict:
    return {"data": data, "meta": meta}


def next_id(state: dict, name: str) -> int:
    seq = state.setdefault("seq", {})
    seq[name] = seq.get(name, 0) + 1
    return seq[name]


def text(body: dict, key: str, *, required: bool = False, max_len: int = 250) -> str:
    value = body.get(key)
    value = "" if value is None else str(value).strip()
    if (required and not value) or len(value) > max_len:
        raise invalid(key)
    return value


def to_date(value, key: str, *, required: bool = True) -> date | None:
    if value in (None, ""):
        if required:
            raise invalid(key)
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise invalid(key) from None


def to_clock(value, key: str) -> str:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?", str(value or "").strip())
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        raise invalid(key)
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def to_amount(value, key: str, *, maximum: float = 9_999_999_999.99) -> float:
    try:
        amount = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        raise invalid(key) from None
    if not 0 < amount <= maximum:
        raise invalid(key)
    return round(amount, 2)


def to_int(value, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def int_list(body: dict, key: str = "ids") -> list[int]:
    values = body.get(key)
    if not isinstance(values, list):
        raise invalid(key)
    return [n for n in (to_int(v) for v in values) if n is not None]


def paged(rows: list, params) -> tuple[list, dict]:
    """The slice asked for with ``limit`` (default 50) and ``offset``, and the meta with the total."""
    limit = to_int(params.get("limit"), 50)
    offset = max(to_int(params.get("offset"), 0) or 0, 0)
    limit = 50 if not limit or limit < 0 else limit
    return rows[offset:offset + limit], {"total": len(rows)}

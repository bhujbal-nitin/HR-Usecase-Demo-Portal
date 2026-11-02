"""Working-day, holiday and punch arithmetic for leave & attendance. The balances, holidays and work week themselves come from OrangeHRM."""

from datetime import date, timedelta

from app.schemas.leave import Holiday

# The only leave types the demo works with, and the yearly quota given to an employee who has none (days).
STANDARD_LEAVE_TYPES = {"Casual Leave": 12.0, "Sick Leave": 12.0, "Privilege Leave": 15.0}

# Attendance: the time proposed as the out-punch, and how far back an attendance request may go.
SHIFT_END = "18:30"
ATTENDANCE_WINDOW_DAYS = 30

_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DEFAULT_WORK_WEEK = {"monday": 0, "tuesday": 0, "wednesday": 0, "thursday": 0, "friday": 0, "saturday": 8, "sunday": 8}  # 8 = non-working


def _is_working(day: date, work_week: dict[str, int], holiday_dates: set[date]) -> bool:
    return work_week.get(_DAY_NAMES[day.weekday()], 0) != 8 and day not in holiday_dates


def _span(start: date, end: date):
    for offset in range((end - start).days + 1):
        yield start + timedelta(days=offset)


def full_day_holidays(holidays: list[dict]) -> dict[date, str]:
    """{date: name} for the holidays that take the whole day off (OrangeHRM length 0)."""
    return {date.fromisoformat(h["date"]): h["name"] for h in holidays if h.get("length", 0) == 0}


def working_days(start: date, end: date, work_week: dict[str, int], holidays: dict[date, str]) -> int:
    """Days in the period that count against the balance: the company's working days, without holidays."""
    return sum(1 for day in _span(start, end) if _is_working(day, work_week, set(holidays)))


def holidays_skipped(start: date, end: date, work_week: dict[str, int], holidays: dict[date, str]) -> list[Holiday]:
    """Holidays inside the period that would otherwise have been working days."""
    return [
        Holiday(date=day, name=holidays[day]) for day in _span(start, end)
        if day in holidays and work_week.get(_DAY_NAMES[day.weekday()], 0) != 8
    ]


def attendance_date_problem(day: date, today: date) -> str | None:
    """Why an attendance request cannot be raised for ``day`` (None when it can): any day in the last 30 days, before today."""
    if day >= today:
        return "An attendance request is for a day that has already passed."
    if day < today - timedelta(days=ATTENDANCE_WINDOW_DAYS):
        return f"An attendance request can only go back {ATTENDANCE_WINDOW_DAYS} days."
    return None


def upcoming_holidays(holidays: list[dict], today: date, count: int = 4) -> list[Holiday]:
    upcoming = sorted((date.fromisoformat(h["date"]), h["name"]) for h in holidays if date.fromisoformat(h["date"]) >= today)
    return [Holiday(date=day, name=name) for day, name in upcoming[:count]]


def minutes(clock: str) -> int:
    hours, mins = clock.split(":")
    return int(hours) * 60 + int(mins)


def hours_worked(in_punch: str, out_punch: str) -> str:
    total = minutes(out_punch) - minutes(in_punch)
    return f"{total // 60}h {total % 60:02d}m"

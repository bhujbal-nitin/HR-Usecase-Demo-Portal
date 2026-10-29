"""Final-settlement arithmetic. Pure functions, no I/O.

This is a simple, transparent estimate for the demo (no tax, PF or other statutory components); the rules are
listed in ``RULES`` and shown to the employee next to the numbers.
"""

from dataclasses import asdict, dataclass
from datetime import date

DAYS_IN_MONTH = 30  # payroll convention

RULES = (
    "Monthly gross = annual CTC / 12; daily rate = monthly gross / 30.",
    "Salary for the final month = daily rate x the day of the month of the last working day (max 30).",
    "Leave encashment = unused leave days x the basic daily rate (basic = a share of the gross).",
    "Notice shortfall = notice period days - days actually served; recovered at the daily rate.",
    "Net payable = salary + leave encashment - notice recovery. Tax and statutory deductions are not included.",
)


@dataclass(frozen=True)
class Settlement:
    monthly_gross: int
    daily_rate: int
    days_paid_in_final_month: int
    salary_payable: int
    leave_days: int
    leave_encashment: int
    notice_period_days: int
    notice_days_served: int
    notice_shortfall_days: int
    notice_recovery: int
    net_payable: int

    def as_dict(self) -> dict:
        return asdict(self)


def calculate(
    annual_ctc: int,
    resignation_date: date,
    last_working_day: date,
    notice_period_days: int,
    leave_balance_days: int,
    basic_share: float = 0.5,
) -> Settlement:
    monthly = annual_ctc / 12
    daily = monthly / DAYS_IN_MONTH
    paid_days = min(last_working_day.day, DAYS_IN_MONTH)
    served = max(0, (last_working_day - resignation_date).days)
    shortfall = max(0, notice_period_days - served)
    salary = round(daily * paid_days)
    encashment = round(daily * basic_share * leave_balance_days)
    recovery = round(daily * shortfall)
    return Settlement(
        monthly_gross=round(monthly),
        daily_rate=round(daily),
        days_paid_in_final_month=paid_days,
        salary_payable=salary,
        leave_days=leave_balance_days,
        leave_encashment=encashment,
        notice_period_days=notice_period_days,
        notice_days_served=served,
        notice_shortfall_days=shortfall,
        notice_recovery=recovery,
        net_payable=salary + encashment - recovery,
    )

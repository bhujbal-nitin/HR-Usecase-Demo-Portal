"""Payroll & salary schemas."""

from app.schemas.common import CamelModel


class PayrollOptions(CamelModel):
    months: list[str]  # the months a payslip can be asked for, newest first (YYYY-MM)

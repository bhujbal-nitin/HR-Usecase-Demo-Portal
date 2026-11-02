"""Use-cases for payroll & salary: the three documents an employee can download (payslip, CTC statement, Form 16).

The employee's annual CTC is read from OrangeHRM (PIM -> Salary, where onboarding recorded it); the split into pay components, the deductions
and the income tax are worked out here by the rules in ``payroll.policy``. The three documents are drawn as PDFs (``payroll.pdf``). Nothing is written anywhere.
"""

import calendar
from datetime import date

from app.core.exceptions import ConflictError, ValidationFailedError
from app.integrations.orangehrm import OrangeHRMClient
from app.schemas.employee import Employee
from app.schemas.offboarding import EmployeeSummary
from app.schemas.payroll import PayrollOptions
from app.services.employee_directory import EmployeeDirectory
from app.services.payroll.form16 import form16_model
from app.services.payroll.pdf import ctc_pdf, form16_pdf, payslip_pdf
from app.services.payroll.slips import ctc_model, payslip_model
from app.utils.formatting import safe_filename

MONTHS_OFFERED = 6


def _month_start(month: str) -> date:
    try:
        year, number = (int(part) for part in month.split("-"))
        return date(year, number, 1)
    except (ValueError, TypeError):
        raise ValidationFailedError("The month must look like 2026-10.") from None


def _recent_months(today: date) -> list[str]:
    """The last completed months, newest first: last month and the ones before it (the current month is not paid yet, a future month even less)."""
    months, year, number = [], today.year, today.month
    for _ in range(MONTHS_OFFERED):
        year, number = (year, number - 1) if number > 1 else (year - 1, 12)
        months.append(f"{year}-{number:02d}")
    return months


class PayrollService:
    def __init__(self, directory: EmployeeDirectory, orangehrm: OrangeHRMClient):
        self._dir = directory
        self._oh = orangehrm

    # ----------------------------------------------------------------- reads
    def _employee(self, ref: str) -> Employee:
        return self._dir.find(ref, "salary records")

    def _annual_ctc(self, employee: Employee) -> int:
        """The annual CTC from the employee's CTC component in OrangeHRM."""
        components = self._oh.salary_components(self._dir.emp_number(employee))
        ctc = next((c for c in components if c["name"].lower() == "ctc" and c["amount"] > 0), None)
        if ctc is None:
            raise ConflictError(f"OrangeHRM has no CTC salary recorded for {employee.full_name} (PIM → employee → Salary).")
        return round(ctc["amount"])

    # ------------------------------------------------------------- use-cases
    def options(self) -> PayrollOptions:
        return PayrollOptions(months=_recent_months(date.today()))

    def lookup(self, ref: str) -> EmployeeSummary:
        return self._dir.summary(self._employee(ref))

    def payslip(self, ref: str, month: str) -> tuple[str, bytes]:
        """The payslip of one month, as a PDF."""
        start = _month_start(month)
        if start >= date.today().replace(day=1):
            raise ValidationFailedError("That month is not over yet, so there is no payslip for it. Choose last month or an earlier one.")
        e = self._employee(ref)
        label = start.strftime("%B %Y")
        days = calendar.monthrange(start.year, start.month)[1]
        model = payslip_model(e, self._annual_ctc(e), label, days, days, date.today())
        return f"Payslip_{label.replace(' ', '_')}_{safe_filename(e.full_name)}.pdf", payslip_pdf(model)

    def ctc(self, ref: str) -> tuple[str, bytes]:
        """The CTC statement as a PDF: the annual CTC split into its components, monthly and yearly."""
        e = self._employee(ref)
        return f"CTC_Statement_{safe_filename(e.full_name)}.pdf", ctc_pdf(ctc_model(e, self._annual_ctc(e), date.today()))

    def form16(self, ref: str) -> tuple[str, bytes]:
        """Form 16 for the last completed financial year as a PDF: the employee's full-year salary, deductions and tax."""
        e = self._employee(ref)
        return f"Form16_{safe_filename(e.full_name)}.pdf", form16_pdf(form16_model(e, self._annual_ctc(e), date.today()))

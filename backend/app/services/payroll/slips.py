"""What the payslip and the CTC statement say: the figures worked out by the payroll rules, arranged for ``payroll.pdf`` to draw.

Both are plain dictionaries (the "model" of the page) so the drawing code knows nothing about employees or rules. The PAN, UAN, provident fund
number, NPS and ESIC are not known to the portal and show a dash.
"""

from datetime import date

from app.schemas.employee import Employee
from app.services.hr_letters import values_for
from app.services.payroll import policy
from app.utils.formatting import format_inr
from app.utils.words import rupees_in_words

COMPANY = "AutomationEdge Technologies Private Limited"
ADDRESS = "Office Address: 402 and 403, Global Port, Mumbai-Bangalore Highway, Baner, Pune 411045"
UNKNOWN = "-"
JOIN_DATE = "%d-%b-%Y"


def _inr(value: int) -> str:
    return format_inr(value, "")


def _info(employee: Employee, today: date, **extra: str) -> tuple[list[str], list[str]]:
    """The lines of the employee block, left and right column (empty strings are gaps; both columns have the same number of lines)."""
    code = values_for(employee, today)["employee code"]
    left = [
        f"Employee Code: {code}", f"Employee Name: {employee.full_name}", f"Group Join Date: {UNKNOWN}", f"Join Date: {employee.start_date.strftime(JOIN_DATE)}",
        f"PAN: {UNKNOWN}", f"Provident Fund: {UNKNOWN}", f"UAN No.: {UNKNOWN}", "", *extra.get("left", []),
    ]
    right = [f"Designation: {employee.job_title}", f"Department: {employee.department}", f"NPS: {UNKNOWN}", f"ESIC: {UNKNOWN}", "", "", "", "", *extra.get("right", [])]
    return left, right


def payslip_model(employee: Employee, annual_ctc: int, month_label: str, paid_days: int, days_in_month: int, today: date) -> dict:
    """One month's pay: the earnings, the deductions (PF, professional tax, TDS under the new regime) and the net pay."""
    s = policy.structure(annual_ctc)
    tds = policy.income_tax(s).monthly_tax
    deductions = s.pf + policy.PROFESSIONAL_TAX_MONTHLY + tds
    net = s.gross - deductions
    short_month = f"{month_label.split()[0][:3]} {month_label.split()[1]}"
    left, right = _info(employee, today, left=[f"Days in Month: {days_in_month}", f"Working Days: {paid_days}"], right=["LOP Days: 0", "Arrear Days: 0"])
    return {
        "company": COMPANY, "address": ADDRESS, "title": f"Salary Slip for {short_month}", "left": left, "right": right,
        "earnings": [("Basic", _inr(s.basic)), ("Conveyance Allowance", _inr(s.conveyance)), ("HRA", _inr(s.hra)), ("Special Allowance", _inr(s.special))],
        "deductions": [("PROV.FUND", _inr(s.pf)), ("P.Tax", _inr(policy.PROFESSIONAL_TAX_MONTHLY)), ("Income Tax (TDS)", _inr(tds))],
        "total_earnings": _inr(s.gross), "total_deductions": _inr(deductions), "net": _inr(net), "words": f"Net Pay: {rupees_in_words(net)}",
    }


def ctc_model(employee: Employee, annual_ctc: int, today: date) -> dict:
    """The annual CTC split into its components, monthly and yearly, with the deductions and the monthly take-home."""
    s = policy.structure(annual_ctc)
    tds = policy.income_tax(s).monthly_tax
    pt = policy.PROFESSIONAL_TAX_MONTHLY
    take_home = s.gross - s.pf - pt - tds
    left, right = _info(employee, today, left=[f"Annual CTC: Rs. {_inr(annual_ctc)}"], right=[f"Date: {today.strftime('%d-%m-%Y')}"])
    yearly_special = annual_ctc - (s.basic + s.conveyance + s.hra) * 12  # what is left, so the parts add up to the CTC

    def row(label: str, monthly: int, yearly: int) -> tuple[str, str, str]:
        return label, _inr(monthly), _inr(yearly)

    return {
        "company": COMPANY, "address": ADDRESS, "title": "CTC Statement", "left": left, "right": right,
        "head": ("Component", "Monthly (Rs.)", "Yearly (Rs.)"),
        "sections": [
            ("Earnings", [row("Basic", s.basic, s.basic * 12), row("Conveyance Allowance", s.conveyance, s.conveyance * 12), row("HRA", s.hra, s.hra * 12),
                          row("Special Allowance", s.special, yearly_special)]),
            ("Deductions", [row("PROV.FUND", s.pf, s.pf * 12), row("P.Tax", pt, pt * 12), row("Income Tax (TDS)", tds, tds * 12)]),
        ],
        "totals": [row("Gross pay (CTC)", s.gross, annual_ctc), row("Take-home pay", take_home, annual_ctc - (s.pf + pt + tds) * 12)],
        "words": f"Annual CTC: {rupees_in_words(annual_ctc)}",
    }

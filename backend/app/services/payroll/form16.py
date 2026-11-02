"""Form 16: the full-year figures of the last completed financial year, arranged for ``payroll.pdf`` to draw.

The figures come from the employee's annual CTC by the payroll rules (new tax regime), the same way the monthly payslip is: no exempt allowances or Chapter VI-A
deductions, the standard deduction, the slab tax and cess, and twelve equal monthly TDS deductions. The PAN, the company's TAN and the quarterly receipt
numbers are not known to the portal and show a dash. The result is a plain dictionary (the "model" of the page).
"""

from datetime import date

from app.schemas.employee import Employee
from app.services.hr_letters import values_for
from app.services.payroll import policy
from app.services.payroll.slips import COMPANY, UNKNOWN

DEDUCTOR_ADDRESS = "402 and 403, Global Port, Mumbai-Bangalore Highway, Baner, Pune 411045"
PLACE = "Pune"
SHOWN_DATE = "%d-%b-%Y"
CERTIFICATE = (
    f"This is to certify that {COMPANY} has deducted tax at source from the salary paid to the employee named above and deposited it to the credit of the "
    "Central Government, as shown in this certificate. The information given is true, complete and correct and is based on the books of account, documents, "
    "TDS statements and other records of the deductor."
)


def financial_year(today: date) -> tuple[str, str]:
    """(financial year, assessment year) of the last completed financial year (April to March), e.g. ("2025-26", "2026-27")."""
    start = today.year - 1 if today.month >= 4 else today.year - 2
    return f"{start}-{(start + 1) % 100:02d}", f"{start + 1}-{(start + 2) % 100:02d}"


def money(value: int) -> str:
    """6,00,000.00 (Indian digit grouping, two decimals)."""
    digits = str(abs(int(value)))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        digits = ",".join(([head] if head else []) + groups + [tail])
    return f"{'-' if value < 0 else ''}{digits}.00"


def form16_model(employee: Employee, annual_ctc: int, today: date) -> dict:
    s = policy.structure(annual_ctc)
    tax = policy.income_tax(s)
    year, assessment = financial_year(today)
    start = int(year[:4])
    quarter = tax.monthly_tax * 3
    deducted = tax.monthly_tax * 12  # what the twelve payslips deducted
    code = values_for(employee, today)["employee code"]
    return {
        "company": COMPANY, "year": year, "assessment": assessment,
        "parties": [
            ("Name", COMPANY, employee.full_name),
            ("Address", DEDUCTOR_ADDRESS, employee.address),
            ("PAN", UNKNOWN, UNKNOWN),
            ("TAN", UNKNOWN, UNKNOWN),
            ("Employee reference / ID", UNKNOWN, code),
            ("Period of employment", UNKNOWN, f"01-Apr-{start} to 31-Mar-{start + 1}"),
        ],
        "quarters": [
            (f"Q{i + 1} ({months} {start + (i == 3)})", UNKNOWN, money(quarter), money(quarter))
            for i, months in enumerate(("Apr-Jun", "Jul-Sep", "Oct-Dec", "Jan-Mar"))
        ] + [("Total", UNKNOWN, money(deducted), money(deducted))],
        "computation": [
            ("Gross salary", money(annual_ctc), False),
            ("Less: Exempt allowances", money(0), False),
            ("Salary after exempt allowances", money(annual_ctc), False),
            ("Less: Standard deduction", money(policy.STANDARD_DEDUCTION), False),
            ("Income chargeable under the head 'Salaries'", money(tax.taxable_income), True),
            ("Income from other sources reported to employer", money(0), False),
            ("Gross total income", money(tax.taxable_income), False),
            ("Deductions under Chapter VI-A", money(0), False),
            ("Total taxable income", money(tax.taxable_income), True),
            ("Income-tax", money(tax.tax_before_cess), False),
            ("Health and Education Cess", money(tax.cess), False),
            ("Total tax liability", money(tax.annual_tax), True),
            ("TDS deducted during the year", money(deducted), True),
        ],
        "certificate": CERTIFICATE, "place": PLACE, "date": today.strftime(SHOWN_DATE), "signatory_for": f"For {COMPANY}",
    }

"""The pay rules of the demo: how an annual CTC is split, what is deducted, and the income tax (new regime).

Amounts are whole rupees. The tax slabs follow the Indian new-regime rules (FY 2025-26 and 2026-27) in simplified form (no marginal relief, no
surcharge, no HRA / home-loan exemptions); the assumptions are listed in ``ASSUMPTIONS`` so the documents can state them.
"""

from dataclasses import dataclass

# ---- salary structure (shares of the annual CTC / of the basic pay)
BASIC_SHARE = 0.40  # basic pay = 40% of CTC
HRA_SHARE_OF_BASIC = 0.50  # house rent allowance = 50% of basic
CONVEYANCE_MONTHLY = 1_600  # conveyance allowance, the same for everyone; the special allowance is whatever is left of the CTC
PF_SHARE_OF_BASIC = 0.12  # employee provident fund
PROFESSIONAL_TAX_MONTHLY = 200
CESS = 0.04  # health & education cess on the tax

# ---- income tax, new regime (annual)
STANDARD_DEDUCTION = 75_000
REBATE_LIMIT = 1_200_000  # no tax when the taxable income is within this
SLABS = [(400_000, 0.0), (800_000, 0.05), (1_200_000, 0.10), (1_600_000, 0.15), (2_000_000, 0.20), (2_400_000, 0.25), (None, 0.30)]  # (upper limit, rate)

ASSUMPTIONS = [
    "The annual CTC recorded in OrangeHRM is the gross yearly pay: basic 40%, HRA 50% of basic, conveyance 1,600 a month, special allowance the rest.",
    "Provident fund is 12% of basic pay; professional tax is 200 per month.",
    "Income tax uses the new tax regime with 4% cess; no surcharge, marginal relief or HRA / home-loan exemptions.",
    "The tax is spread equally over the 12 months and the employee is paid for the full month.",
]


@dataclass(frozen=True)
class SalaryStructure:
    """Monthly pay split, in whole rupees."""

    annual_ctc: int
    basic: int
    hra: int
    conveyance: int
    special: int
    gross: int  # = basic + hra + conveyance + special (the CTC / 12, rounded)
    pf: int


@dataclass(frozen=True)
class TaxResult:
    taxable_income: int
    tax_before_cess: int
    cess: int
    annual_tax: int
    monthly_tax: int


def structure(annual_ctc: int) -> SalaryStructure:
    gross = round(annual_ctc / 12)
    basic = round(gross * BASIC_SHARE)
    hra = round(basic * HRA_SHARE_OF_BASIC)
    return SalaryStructure(annual_ctc=annual_ctc, basic=basic, hra=hra, conveyance=CONVEYANCE_MONTHLY, special=gross - basic - hra - CONVEYANCE_MONTHLY, gross=gross, pf=round(basic * PF_SHARE_OF_BASIC))


def _slab_tax(income: int) -> float:
    tax, floor = 0.0, 0
    for limit, rate in SLABS:
        top = income if limit is None else min(income, limit)
        if top > floor:
            tax += (top - floor) * rate
        if limit is None or income <= limit:
            break
        floor = limit
    return tax


def income_tax(s: SalaryStructure) -> TaxResult:
    """The yearly income tax on this structure under the new regime."""
    taxable = max(0, s.annual_ctc - STANDARD_DEDUCTION)
    before_cess = 0 if taxable <= REBATE_LIMIT else round(_slab_tax(taxable))
    cess = round(before_cess * CESS)
    annual = before_cess + cess
    return TaxResult(taxable_income=taxable, tax_before_cess=before_cess, cess=cess, annual_tax=annual, monthly_tax=round(annual / 12))

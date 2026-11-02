"""Payroll & salary: the pay rules, the OrangeHRM salary read the payslip, CTC statement and Form 16 PDFs (OrangeHRM replaced by a fake)."""

from datetime import date, timedelta

import pytest

from app.core.exceptions import IntegrationError
from app.integrations.orangehrm_payroll import PayrollMixin
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.services.payroll import policy
from app.services.payroll.form16 import financial_year, form16_model, money
from app.services.payroll.pdf import ctc_pdf, form16_pdf, payslip_pdf
from app.services.payroll.slips import ctc_model, payslip_model
from app.utils.words import rupees_in_words
from tests.test_hr_policy import FakeAutomationEdge



# --------------------------------------------------------------------------------------------------- the pay rules
def test_structure_splits_the_ctc_into_basic_hra_conveyance_and_special():
    s = policy.structure(2_100_000)
    assert (s.gross, s.basic, s.hra, s.conveyance, s.special, s.pf) == (175_000, 70_000, 35_000, 1_600, 68_400, 8_400)
    assert s.basic + s.hra + s.conveyance + s.special == s.gross


def test_income_tax_uses_the_new_regime_slabs_and_cess():
    tax = policy.income_tax(policy.structure(2_100_000))
    assert tax.taxable_income == 2_025_000
    assert (tax.tax_before_cess, tax.cess, tax.annual_tax, tax.monthly_tax) == (206_250, 8_250, 214_500, 17_875)


def test_no_tax_when_the_taxable_income_is_within_the_rebate_limit():
    assert policy.income_tax(policy.structure(1_200_000)).annual_tax == 0


# --------------------------------------------------------------------------------------- the OrangeHRM salary read
class Stub(PayrollMixin):
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def _leave_call(self, method, path, **kwargs):
        self.calls.append((method, path))
        return self.answer


def test_salary_components_are_read_from_pim():
    stub = Stub({"data": [
        {"id": 28, "amount": "2100000", "salaryName": "CTC", "currencyType": {"id": "INR", "name": "Indian Rupee"}},
        {"id": 29, "amount": "n/a", "salaryName": "Broken", "currencyType": {}},
    ]})
    assert stub.salary_components(99) == [{"name": "CTC", "amount": 2_100_000.0, "currency": "INR"}]
    assert stub.calls == [("GET", "pim/employees/99/salary-components")]


def test_salary_components_tolerate_an_empty_answer():
    assert Stub({"data": None}).salary_components(99) == []


# -------------------------------------------------------------------------------------------------- the field values
def an_employee(**changes) -> Employee:
    values = dict(
        id="AE-111111", full_name="Aarav Sharma", email="a@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20), aadhaar="234567890123",
        emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering", job_title="Engineer", manager="Amit D",
        start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook", status=EmployeeStatus.APPROVED, orange_hrm=OrangeHrmInfo(emp_number=77, employee_id="111111"),
    )
    return Employee(**{**values, **changes})


TODAY = date(2026, 10, 30)


def test_the_payslip_model_is_one_months_pay():
    m = payslip_model(an_employee(), 2_100_000, "October 2026", 31, 31, TODAY)
    assert m["title"] == "Salary Slip for Oct 2026"
    assert "Employee Code: AE111111" in m["left"] and "Employee Name: Aarav Sharma" in m["left"] and "Join Date: 05-Jan-2026" in m["left"]
    assert "Designation: Engineer" in m["right"] and "Department: Engineering" in m["right"]
    assert "Days in Month: 31" in m["left"] and "Working Days: 31" in m["left"] and "PAN: -" in m["left"]
    assert m["earnings"] == [("Basic", "70,000"), ("Conveyance Allowance", "1,600"), ("HRA", "35,000"), ("Special Allowance", "68,400")]
    assert m["deductions"] == [("PROV.FUND", "8,400"), ("P.Tax", "200"), ("Income Tax (TDS)", "17,875")]
    assert (m["total_earnings"], m["total_deductions"], m["net"]) == ("1,75,000", "26,475", "1,48,525")
    assert m["words"] == "Net Pay: One Lakh Forty Eight Thousand Five Hundred Twenty Five Rupees"


def test_the_ctc_model_splits_the_ctc_monthly_and_yearly_and_adds_up():
    m = ctc_model(an_employee(), 2_100_000, TODAY)
    assert "Annual CTC: Rs. 21,00,000" in m["left"]
    (_, earnings), (_, deductions) = m["sections"]
    assert earnings == [("Basic", "70,000", "8,40,000"), ("Conveyance Allowance", "1,600", "19,200"), ("HRA", "35,000", "4,20,000"), ("Special Allowance", "68,400", "8,20,800")]
    assert deductions == [("PROV.FUND", "8,400", "1,00,800"), ("P.Tax", "200", "2,400"), ("Income Tax (TDS)", "17,875", "2,14,500")]
    assert m["totals"] == [("Gross pay (CTC)", "1,75,000", "21,00,000"), ("Take-home pay", "1,48,525", "17,82,300")]
    for ctc in (1_200_001, 1_999_999, 2_100_007):
        yearly = [int(row[2].replace(",", "")) for row in ctc_model(an_employee(), ctc, TODAY)["sections"][0][1]]
        assert sum(yearly) == ctc


def test_amounts_are_written_in_words_the_indian_way():
    assert rupees_in_words(30_676) == "Thirty Thousand Six Hundred Seventy Six Rupees"
    assert rupees_in_words(2_400_000) == "Twenty Four Lakh Rupees"
    assert rupees_in_words(10_000_000) == "One Crore Rupees"
    assert rupees_in_words(0) == "Zero Rupees"


def test_the_pdfs_are_one_page_and_carry_the_employee_and_figures():
    slip = payslip_pdf(payslip_model(an_employee(), 2_100_000, "October 2026", 31, 31, TODAY))
    ctc = ctc_pdf(ctc_model(an_employee(), 2_100_000, TODAY))
    for pdf, texts in ((slip, [b"Aarav Sharma", b"AE111111", b"Salary Slip for Oct 2026", b"1,48,525"]), (ctc, [b"Aarav Sharma", b"CTC Statement", b"21,00,000", b"Take-home pay"])):
        assert pdf.startswith(b"%PDF") and pdf.count(b"/Type /Page\n") == 1
        assert all(t in pdf for t in texts), [t for t in texts if t not in pdf]


@pytest.mark.parametrize("today, expected", [
    (date(2026, 10, 30), ("2025-26", "2026-27")), (date(2026, 4, 1), ("2025-26", "2026-27")), (date(2026, 3, 31), ("2024-25", "2025-26")),
    (date(2027, 1, 15), ("2025-26", "2026-27")), (date(2099, 12, 1), ("2098-99", "2099-00")),
])
def test_form16_is_for_the_last_completed_financial_year(today, expected):
    assert financial_year(today) == expected


def test_money_has_indian_grouping_and_two_decimals():
    assert (money(600000), money(22000), money(0), money(250)) == ("6,00,000.00", "22,000.00", "0.00", "250.00")


def test_the_form16_model_follows_the_payslip_rules_and_adds_up():
    m = form16_model(an_employee(), 2_100_000, TODAY)
    assert (m["year"], m["assessment"]) == ("2025-26", "2026-27")
    parties = {label: (deductor, deductee) for label, deductor, deductee in m["parties"]}
    assert parties["Name"] == ("AutomationEdge Technologies Private Limited", "Aarav Sharma")
    assert parties["Address"][1] == "Pune 411045" and parties["PAN"] == ("-", "-") and parties["TAN"] == ("-", "-")
    assert parties["Employee reference / ID"] == ("-", "AE111111") and parties["Period of employment"][1] == "01-Apr-2025 to 31-Mar-2026"
    assert [q[0] for q in m["quarters"]] == ["Q1 (Apr-Jun 2025)", "Q2 (Jul-Sep 2025)", "Q3 (Oct-Dec 2025)", "Q4 (Jan-Mar 2026)", "Total"]
    assert [q[2:] for q in m["quarters"]] == [("53,625.00", "53,625.00")] * 4 + [("2,14,500.00", "2,14,500.00")]
    assert all(q[1] == "-" for q in m["quarters"])  # the portal has no receipt numbers
    figures = {label: amount for label, amount, _ in m["computation"]}
    assert (figures["Gross salary"], figures["Less: Standard deduction"], figures["Total taxable income"]) == ("21,00,000.00", "75,000.00", "20,25,000.00")
    assert (figures["Income-tax"], figures["Health and Education Cess"], figures["Total tax liability"], figures["TDS deducted during the year"]) == (
        "2,06,250.00", "8,250.00", "2,14,500.00", "2,14,500.00")
    assert figures["Less: Exempt allowances"] == figures["Deductions under Chapter VI-A"] == "0.00"
    assert "demo" not in str(m).lower() and "sample" not in str(m).lower()  # reads like the real certificate


def test_the_form16_pdf_is_one_page_with_the_employee_and_figures():
    pdf = form16_pdf(form16_model(an_employee(), 2_100_000, TODAY))
    assert pdf.startswith(b"%PDF") and pdf.count(b"/Type /Page\n") == 1
    for text in (b"FORM NO. 16", b"Aarav Sharma", b"AE111111", b"Financial Year 2025-26", b"20,25,000.00", b"Authorised Signatory"):
        assert text in pdf, text


# -------------------------------------------------------------------------------------------------------------- API
class FakeOrangeHRM:
    def __init__(self, components):
        self.components, self.asked = components, []

    def salary_components(self, emp_number):
        self.asked.append(emp_number)
        return self.components

    def find_employee_number(self, name):
        return 55


@pytest.fixture
def world(client):
    container = client.app.state.container
    for ident, name, number, status in (
        ("AE-111111", "Aarav Sharma", 77, EmployeeStatus.APPROVED),
        ("AE-222222", "Meera Kulkarni", None, EmployeeStatus.APPROVED),  # no OrangeHRM number recorded: found by name
        ("AE-333333", "Rohan Patil", 88, EmployeeStatus.REJECTED),
    ):
        container.repository.add(an_employee(
            id=ident, full_name=name, email=f"{ident.lower()}@example.com", status=status,
            orange_hrm=OrangeHrmInfo(emp_number=number, employee_id=ident[3:]) if number else None,
        ))
    fake = FakeOrangeHRM([{"name": "CTC", "amount": 2_100_000.0, "currency": "INR"}])
    container.payroll._oh = fake
    container.payroll._dir._orangehrm = fake
    return client, fake


def this_month() -> str:
    return date.today().strftime("%Y-%m")


def test_the_payslip_is_a_pdf_for_that_month(world):
    client, fake = world
    answer = client.get("/api/payroll/payslip/download", params={"ref": "AE-111111", "month": "2026-10"})
    assert answer.status_code == 200 and answer.headers["content-type"] == "application/pdf"
    assert 'filename="Payslip_October_2026_Aarav_Sharma.pdf"' in answer.headers["content-disposition"]
    assert answer.content.startswith(b"%PDF") and b"Aarav Sharma" in answer.content and b"AE111111" in answer.content and b"1,48,525" in answer.content
    assert fake.asked == [77]  # the CTC of the right employee was read from OrangeHRM


def test_the_ctc_statement_is_a_pdf(world):
    client, _ = world
    answer = client.get("/api/payroll/ctc/download", params={"ref": "AE-111111"})
    assert answer.status_code == 200 and answer.headers["content-type"] == "application/pdf"
    assert 'filename="CTC_Statement_Aarav_Sharma.pdf"' in answer.headers["content-disposition"]
    assert b"Aarav Sharma" in answer.content and b"21,00,000" in answer.content


def test_form16_is_a_pdf_for_the_last_financial_year(world):
    client, _ = world
    answer = client.get("/api/payroll/form16/download", params={"ref": "ae-111111"})
    assert answer.status_code == 200 and answer.headers["content-type"] == "application/pdf"
    assert 'filename="Form16_Aarav_Sharma.pdf"' in answer.headers["content-disposition"]
    year, _ = financial_year(date.today())
    assert f"Financial Year {year}".encode() in answer.content and b"Aarav Sharma" in answer.content and b"2,14,500.00" in answer.content


def test_an_employee_without_a_recorded_number_is_found_in_orangehrm_by_name(world):
    client, fake = world
    assert client.get("/api/payroll/ctc/download", params={"ref": "AE-222222"}).status_code == 200
    assert fake.asked == [55]


def test_a_payslip_for_the_current_or_a_future_or_badly_written_month_is_refused(world):
    client, _ = world
    first = date.today().replace(day=1)
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    for month in (first, nxt):
        answer = client.get("/api/payroll/payslip/download", params={"ref": "AE-111111", "month": month.strftime("%Y-%m")})
        assert answer.status_code == 422 and "not over yet" in answer.text
    assert client.get("/api/payroll/payslip/download", params={"ref": "AE-111111", "month": "October"}).status_code == 422


def test_the_month_just_ended_can_be_downloaded(world):
    client, _ = world
    last = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    assert client.get("/api/payroll/payslip/download", params={"ref": "AE-111111", "month": last}).status_code == 200


def test_options_offer_the_last_completed_months_newest_first(world):
    client, _ = world
    months = client.get("/api/payroll/options").json()["months"]
    last = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    assert months[0] == last and this_month() not in months and len(months) == 6 and months == sorted(months, reverse=True)


def test_unknown_and_not_onboarded_employees_are_refused(world):
    client, _ = world
    for path in ("/api/payroll/ctc/download", "/api/payroll/form16/download"):
        assert client.get(path, params={"ref": "nobody@example.com"}).status_code == 404
        answer = client.get(path, params={"ref": "AE-333333"})
        assert answer.status_code == 409 and "has not completed onboarding" in answer.text


def test_a_missing_ctc_in_orangehrm_is_reported(world):
    client, fake = world
    fake.components = [{"name": "Bonus", "amount": 5000.0, "currency": "INR"}]
    answer = client.get("/api/payroll/ctc/download", params={"ref": "AE-111111"})
    assert answer.status_code == 409 and "no CTC salary" in answer.json()["detail"]


def test_an_orangehrm_failure_is_passed_on_as_a_bad_gateway(world):
    client, fake = world
    fake.salary_components = lambda emp: (_ for _ in ()).throw(IntegrationError("OrangeHRM", "down"))
    assert client.get("/api/payroll/ctc/download", params={"ref": "AE-111111"}).status_code == 502


def test_the_old_pdf_and_detail_endpoints_are_gone(world):
    client, _ = world
    for path in ("/api/payroll/salary", "/api/payroll/payslip", "/api/payroll/payslip/pdf", "/api/payroll/ctc/pdf", "/api/payroll/tax-comparison"):
        assert client.get(path, params={"ref": "AE-111111", "month": this_month()}).status_code == 404


@pytest.mark.parametrize("key, method", [
    ("fetch-salary", "fetch_salary_details"), ("generate-payslip", "generate_payslip"),
    ("generate-ctc", "generate_ctc_statement"), ("generate-form16", "generate_form16"),
])
def test_each_showcase_workflow_runs_its_own_automationedge_workflow(world, key, method):
    client = world[0]
    ae = client.app.state.container.automationedge = FakeAutomationEdge()
    body = client.post(f"/api/payroll/workflows/{key}").json()
    assert ae.ran == [method]
    assert body["ok"] is True and body["status"] == "Complete"


def test_an_unknown_payroll_workflow_is_404_and_unconfigured_automationedge_a_clear_error(world):
    client = world[0]
    assert client.post("/api/payroll/workflows/nope").status_code == 404
    response = client.post("/api/payroll/workflows/fetch-salary")
    assert response.status_code == 502 and "not configured" in response.json()["detail"]


def test_the_payroll_workflow_names_come_from_the_settings(settings):
    assert (settings.ae_workflow_fetch_salary, settings.ae_workflow_generate_payslip, settings.ae_workflow_generate_ctc,
            settings.ae_workflow_generate_form16) == (
        "HR Demo Fetch Salary Details", "HR Demo Generate Payslip", "HR Demo Generate CTC Statement", "HR Demo Generate Form 16")

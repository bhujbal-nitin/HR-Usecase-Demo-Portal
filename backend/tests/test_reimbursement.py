"""Reimbursement & benefits: reading bills, the Travel / Food policy hint, the per-bill decision and recording in OrangeHRM (OpenAI and OrangeHRM replaced by fakes)."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.core.exceptions import IntegrationError
from app.integrations.orangehrm_claim import ClaimMixin
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.schemas.reimbursement import ExpenseItem
from app.services.reimbursement import policy
from app.services.reimbursement.bill_reader import BillReader


# ----------------------------------------------------------------------------------------------------------- the rules
def item(expense_type: str, amount: float, vendor: str = "V") -> ExpenseItem:
    return ExpenseItem(file_name="b.pdf", expense_type=expense_type, amount=amount, vendor=vendor, within_policy=policy.within_policy(expense_type))


def test_travel_and_food_are_within_policy():
    assert [t for t in policy.EXPENSE_TYPES if policy.within_policy(t)] == ["Travel", "Food"]
    assert [policy.normalise_type(v) for v in ("food", " TRAVEL ", "hotel", None, "Stay")] == ["Food", "Travel", "Others", "Others", "Stay"]


def test_totals_add_up_the_amounts():
    items = [item("Food", 6634), item("Stay", 45400), item("Travel", 342.5), item("Others", 1258)]
    assert (policy.total(items), policy.total([]), policy.total(items[:1])) == (53634.5, 0, 6634)


# ------------------------------------------------------------------------------------------------------- the reader
class FakeOpenAI:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def is_configured(self):
        return True

    def read(self, filename, content, content_type, prompt=None):
        self.calls.append((filename, content_type, prompt))
        return self.answer


def test_the_reader_turns_the_models_answer_into_a_bill():
    openai = FakeOpenAI({"expenseType": "food", "date": "2026-10-20", "amount": "1,234.50", "vendor": " Cafe Roma ", "readable": True, "issues": []})
    bill = BillReader(openai).read("lunch.PDF", b"x", "application/pdf")
    assert (bill.expense_type, bill.date, bill.amount, bill.vendor, bill.within_policy) == ("Food", date(2026, 10, 20), 1234.5, "Cafe Roma", True)
    assert "Travel" in openai.calls[0][2] and "JSON" in openai.calls[0][2]  # the expense prompt, not the identity-document one


def test_the_reader_is_careful_with_what_it_cannot_read():
    bill = BillReader(FakeOpenAI({"expenseType": "Spa", "date": "20/10/2026", "amount": 99, "vendor": None, "readable": True})).read("a.png", b"x", "image/png")
    assert (bill.expense_type, bill.date, bill.vendor, bill.within_policy) == ("Others", None, "Unknown vendor", False)  # unknown type, unreadable date
    for answer in ({"amount": None, "readable": True}, {"amount": 50, "readable": False, "issues": ["blurry"]}, {"amount": "abc"}, {"amount": 0}):
        with pytest.raises(Exception, match="could not read the amount"):
            BillReader(FakeOpenAI(answer)).read("a.pdf", b"x", "application/pdf")


def test_the_reader_only_accepts_pdfs_and_photos():
    for name in ("sheet.xlsx", "notes.txt", "letter.docx", "noext"):
        with pytest.raises(Exception, match="PDF or a photo"):
            BillReader(FakeOpenAI({})).read(name, b"x", None)


# ------------------------------------------------------------------------------------------- the OrangeHRM claim calls
class Stub(ClaimMixin):
    base_url = "http://hrm.example/orangehrm"

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def _leave_call(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return self.answers.pop(0)


def test_claim_calls_send_what_orangehrm_expects():
    stub = Stub({"data": [{"id": 1, "name": "Trips"}, {"id": 2, "name": "Old", "deleted": True}]}, {"data": {"id": 7}}, {"data": {"id": 31}}, {}, {}, {})
    assert stub.claim_events() == [{"id": 1, "name": "Trips"}]
    assert stub.create_claim_event("Employee Expense Reimbursement") == 7
    assert stub.assign_claim(77, 7, "INR", "note") == 31
    stub.add_claim_expense(31, 4, date(2026, 10, 20), 1234.5, "Cafe (b.pdf)")
    stub.submit_claim(31)
    assert [c[:2] for c in stub.calls[1:]] == [
        ("POST", "claim/events"), ("POST", "claim/employees/77/requests"), ("POST", "claim/requests/31/expenses"), ("PUT", "claim/requests/31/action"),
    ]
    assert stub.calls[2][2]["json"] == {"claimEventId": 7, "currencyId": "INR", "remarks": "note"}
    assert stub.calls[3][2]["json"] == {"expenseTypeId": 4, "date": "2026-10-20", "amount": "1234.50", "note": "Cafe (b.pdf)"}
    assert stub.calls[4][2]["json"] == {"action": "SUBMIT"}


def test_a_created_item_without_an_id_is_an_error():
    with pytest.raises(IntegrationError, match="did not return an id"):
        Stub({"data": {}}).create_claim_event("X")


# ------------------------------------------------------------------------------------------------------------ API
class FakeOrangeHRM:
    def __init__(self):
        self.events, self.types = [], []
        self.claims: list[dict] = []
        self.fail: set[str] = set()

    def _maybe_fail(self, name):
        if name in self.fail:
            raise IntegrationError("OrangeHRM", f"{name} refused")

    def claim_events(self):
        return list(self.events)

    def create_claim_event(self, name):
        self.events.append({"id": 10 + len(self.events), "name": name})
        return self.events[-1]["id"]

    def claim_expense_types(self):
        return list(self.types)

    def create_claim_expense_type(self, name):
        self.types.append({"id": 20 + len(self.types), "name": name})
        return self.types[-1]["id"]

    def assign_claim(self, emp_number, event_id, currency, remarks):
        self._maybe_fail("assign_claim")
        self.claims.append({"id": 500 + len(self.claims), "emp": emp_number, "event": event_id, "currency": currency, "expenses": [], "submitted": False})
        return self.claims[-1]["id"]

    def add_claim_expense(self, claim_id, expense_type_id, day, amount, note):
        self._maybe_fail("add_claim_expense")
        next(c for c in self.claims if c["id"] == claim_id)["expenses"].append({"type": expense_type_id, "date": day, "amount": amount, "note": note})

    def submit_claim(self, claim_id):
        self._maybe_fail("submit_claim")
        next(c for c in self.claims if c["id"] == claim_id)["submitted"] = True

    def claim_url(self, claim_id):
        return f"http://hrm.example/claim/{claim_id}"

    def find_employee_number(self, name):
        return 55


@pytest.fixture
def world(client):
    container = client.app.state.container
    for ident, name, number, status in (
        ("AE-111111", "Aarav Sharma", 77, EmployeeStatus.APPROVED),
        ("AE-222222", "Meera Kulkarni", None, EmployeeStatus.APPROVED),
        ("AE-333333", "Rohan Patil", 88, EmployeeStatus.REJECTED),
    ):
        container.repository.add(Employee(
            id=ident, full_name=name, email=f"{ident.lower()}@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
            aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
            job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook", status=status,
            orange_hrm=OrangeHrmInfo(emp_number=number) if number else None,
        ))
    fake = FakeOrangeHRM()
    gw = container.reimbursement._gw
    gw.orangehrm = fake
    container.reimbursement._dir._orangehrm = fake
    return client, SimpleNamespace(oh=fake, openai=gw.bills._reader, gw=gw)


def bill(expense_type: str, amount: float, vendor: str = "Vendor", day: str | None = "2026-10-20", file_name: str = "bill.pdf") -> dict:
    return {"fileName": file_name, "expenseType": expense_type, "date": day, "amount": amount, "vendor": vendor, "withinPolicy": True, "approved": True}  # both flags are ignored


def claim_body(*items: dict, ref: str = "AE-111111") -> dict:
    return {"employeeRef": ref, "items": list(items)}


def submit(client, *items: dict) -> dict:
    return client.post("/api/reimbursement/claims", json=claim_body(*items)).json()


def test_a_bill_is_read_from_an_upload(world):
    client, w = world
    w.gw.bills._reader = FakeOpenAI({"expenseType": "Travel", "date": "2026-10-19", "amount": 342, "vendor": "OLA", "readable": True})
    answer = client.post("/api/reimbursement/bills/read", data={"ref": "AE-111111"}, files={"file": ("ola.pdf", b"%PDF-1.4 x", "application/pdf")})
    assert answer.status_code == 200
    assert answer.json() == {"fileName": "ola.pdf", "expenseType": "Travel", "date": "2026-10-19", "amount": 342.0, "vendor": "OLA", "withinPolicy": True, "approved": None}


def test_reading_a_bill_is_refused_without_openai_for_unknown_people_and_bad_files(world):
    client, w = world
    upload = {"file": ("ola.pdf", b"%PDF-1.4 x", "application/pdf")}
    assert client.post("/api/reimbursement/bills/read", data={"ref": "AE-111111"}, files=upload).status_code == 502  # no OPENAI_API_KEY in the tests
    w.gw.bills._reader = FakeOpenAI({})
    assert client.post("/api/reimbursement/bills/read", data={"ref": "nobody@example.com"}, files=upload).status_code == 404
    assert client.post("/api/reimbursement/bills/read", data={"ref": "AE-333333"}, files=upload).status_code == 409
    assert client.post("/api/reimbursement/bills/read", data={"ref": "AE-111111"}, files={"file": ("notes.txt", b"hello", "text/plain")}).status_code == 422
    assert client.post("/api/reimbursement/bills/read", data={"ref": "AE-111111"}, files={"file": ("e.pdf", b"", "application/pdf")}).status_code == 422
    assert client.post("/api/reimbursement/bills/read", data={"ref": "AE-111111"}).status_code == 422


def test_a_claim_carries_bills_of_every_kind_and_marks_the_policy_itself(world):
    client, _ = world
    claim = submit(client, bill("Food", 6634), bill("stay", 45400), bill("Travel", 342.5), bill("Spa", 1258))
    assert claim["id"].startswith("RC-") and claim["status"] == "Pending Approval" and claim["manager"] == "Amit D"
    assert [i["expenseType"] for i in claim["items"]] == ["Food", "Stay", "Travel", "Others"]  # the case is tidied; "Spa" is not a known category
    assert [i["withinPolicy"] for i in claim["items"]] == [True, False, True, False]  # the chat said True for all; the portal decides
    assert [i["approved"] for i in claim["items"]] == [None] * 4  # nothing is decided yet, whatever the chat sent
    assert (claim["totalAmount"], claim["approvedTotal"]) == (53634.5, None)


def test_a_claim_of_only_bills_outside_the_policy_is_still_accepted(world):
    client, _ = world
    claim = client.post("/api/reimbursement/claims", json=claim_body(bill("Stay", 5000), bill("Medical", 300)))
    assert claim.status_code == 201 and claim.json()["totalAmount"] == 5300
    assert client.post("/api/reimbursement/claims", json=claim_body()).status_code == 422  # but it needs at least one bill


def test_the_manager_approves_or_rejects_each_bill(world):
    client, w = world
    claim = submit(client, bill("Food", 6634, "Cafe", "2026-10-20"), bill("Stay", 45400, "Hotel"), bill("Travel", 342.5, "OLA", None), bill("Medical", 300, "Clinic"))
    assert w.oh.claims == []  # nothing is recorded before the manager decides
    assert client.post(f"/api/reimbursement/claims/{claim['id']}/apply").status_code == 409  # not decided yet

    decided = client.post(f"/api/reimbursement/claims/{claim['id']}/approve", json={"approvedBills": [0, 1, 2]}).json()  # approve three, reject the medical bill
    assert decided["status"] == "Approved" and [i["approved"] for i in decided["items"]] == [True, True, True, False]
    assert decided["approvedTotal"] == 52376.5 and decided["totalAmount"] == 52676.5
    assert w.oh.claims == []  # decided, not yet recorded

    done = client.post(f"/api/reimbursement/claims/{claim['id']}/apply").json()
    assert done["applied"] and done["orangeHrmId"] == 500 and done["orangeHrmUrl"] == "http://hrm.example/claim/500"
    assert [e["name"] for e in w.oh.events] == ["Employee Expense Reimbursement"]
    assert sorted(t["name"] for t in w.oh.types) == ["Food", "Stay", "Travel"]  # only the types of the approved bills are created
    recorded = w.oh.claims[0]
    assert recorded["emp"] == 77 and recorded["currency"] == "INR" and recorded["submitted"] is True
    assert [(e["amount"], e["note"]) for e in recorded["expenses"]] == [(6634, "Cafe (bill.pdf)"), (45400, "Hotel (bill.pdf)"), (342.5, "OLA (bill.pdf)")]  # the rejected bill is not recorded
    assert recorded["expenses"][0]["date"] == date(2026, 10, 20) and recorded["expenses"][2]["date"] == date.today()  # no printed date: the day it was claimed

    assert client.post(f"/api/reimbursement/claims/{claim['id']}/apply").json()["applied"]  # a repeat records nothing more
    assert len(w.oh.claims) == 1 and len(w.oh.events) == 1


def test_approving_without_a_choice_approves_every_bill(world):
    client, _ = world
    claim = submit(client, bill("Food", 100), bill("Stay", 200))
    decided = client.post(f"/api/reimbursement/claims/{claim['id']}/approve").json()
    assert [i["approved"] for i in decided["items"]] == [True, True] and decided["approvedTotal"] == 300


def test_the_manager_must_choose_something_valid(world):
    client, _ = world
    claim = submit(client, bill("Food", 100), bill("Stay", 200))
    url = f"/api/reimbursement/claims/{claim['id']}/approve"
    assert client.post(url, json={"approvedBills": []}).status_code == 422  # nothing chosen: reject the claim instead
    assert client.post(url, json={"approvedBills": [0, 5]}).status_code == 422  # no such bill
    assert client.get(f"/api/reimbursement/claims/{claim['id']}").json()["status"] == "Pending Approval"  # still waiting


def test_a_rejected_claim_is_never_recorded(world):
    client, w = world
    claim = submit(client, bill("Food", 100))
    rejected = client.post(f"/api/reimbursement/claims/{claim['id']}/reject").json()
    assert rejected["status"] == "Rejected" and rejected["items"][0]["approved"] is False and rejected["approvedTotal"] == 0
    assert client.post(f"/api/reimbursement/claims/{claim['id']}/approve").status_code == 409  # already decided
    assert client.post(f"/api/reimbursement/claims/{claim['id']}/apply").status_code == 409
    assert w.oh.claims == []


def test_a_failed_recording_carries_on_where_it_stopped(world):
    client, w = world
    claim = submit(client, bill("Food", 100), bill("Travel", 200), bill("Stay", 300), bill("Food", 400))
    client.post(f"/api/reimbursement/claims/{claim['id']}/approve", json={"approvedBills": [0, 1, 3]})
    original = w.oh.add_claim_expense
    seen = []

    def flaky(claim_id, type_id, day, amount, note):
        if len(seen) == 1:  # the second approved bill fails once
            seen.append("fail")
            raise IntegrationError("OrangeHRM", "add_claim_expense refused")
        seen.append(amount)
        original(claim_id, type_id, day, amount, note)

    w.oh.add_claim_expense = flaky
    assert client.post(f"/api/reimbursement/claims/{claim['id']}/apply").status_code == 502
    assert [e["amount"] for e in w.oh.claims[0]["expenses"]] == [100] and not w.oh.claims[0]["submitted"]
    assert client.get(f"/api/reimbursement/claims/{claim['id']}").json()["expensesRecorded"] == 1

    assert client.post(f"/api/reimbursement/claims/{claim['id']}/apply").json()["applied"]
    assert len(w.oh.claims) == 1  # the same OrangeHRM claim was carried on, not a second one
    assert [e["amount"] for e in w.oh.claims[0]["expenses"]] == [100, 200, 400] and w.oh.claims[0]["submitted"]


def test_clear_removes_decided_claims_only(world):
    client, _ = world
    done = submit(client, bill("Food", 10))
    client.post(f"/api/reimbursement/claims/{done['id']}/approve")
    pending = submit(client, bill("Food", 20))
    assert client.delete("/api/reimbursement/claims").json() == {"removed": 1}
    assert [c["id"] for c in client.get("/api/reimbursement/claims").json()] == [pending["id"]]
    assert client.get("/api/reimbursement/claims/RC-000000").status_code == 404


def test_lookup_finds_an_onboarded_employee(world):
    client, _ = world
    assert client.get("/api/reimbursement/lookup", params={"ref": "ae-111111"}).json()["fullName"] == "Aarav Sharma"
    assert client.get("/api/reimbursement/lookup", params={"ref": "AE-333333"}).status_code == 409


# ------------------------------------------------------------------------------------------- AutomationEdge showcase workflows
class FakeAutomationEdge:
    def __init__(self, status="Complete"):
        self.status, self.ran = status, []

    def __getattr__(self, method):
        def run():
            self.ran.append(method)
            return SimpleNamespace(workflow_name=f"WF {method}", execution_status=self.status, ok=self.status == "Complete",
                                   automation_request_id=601, agent_name="agent-1", message="done", instance_url=None)
        return run


@pytest.mark.parametrize("key, method", [
    ("read-bill", "read_bill"), ("check-policy", "check_reimbursement_policy"),
    ("submit-claim", "submit_expense_claim"), ("create-claim", "create_claim_orangehrm"),
])
def test_each_showcase_workflow_runs_its_own_automationedge_workflow(world, key, method):
    client, _ = world
    ae = client.app.state.container.automationedge = FakeAutomationEdge()
    body = client.post(f"/api/reimbursement/workflows/{key}").json()
    assert ae.ran == [method]
    assert body["ok"] is True and body["status"] == "Complete" and body["automationRequestId"] == 601


def test_a_workflow_that_does_not_complete_is_reported_not_ok(world):
    client, _ = world
    client.app.state.container.automationedge = FakeAutomationEdge("Failure")
    body = client.post("/api/reimbursement/workflows/read-bill").json()
    assert body["ok"] is False and body["status"] == "Failure"


def test_an_unknown_workflow_is_404_and_unconfigured_automationedge_is_a_clear_error(world):
    client, _ = world
    assert client.post("/api/reimbursement/workflows/nope").status_code == 404
    response = client.post("/api/reimbursement/workflows/read-bill")  # the test settings have no AutomationEdge credentials
    assert response.status_code == 502 and "not configured" in response.json()["detail"]


def test_the_workflow_names_come_from_the_settings(settings):
    assert (settings.ae_workflow_read_bill, settings.ae_workflow_check_reimbursement_policy, settings.ae_workflow_submit_expense_claim, settings.ae_workflow_create_claim) == (
        "HR Demo Read Bill", "HR Demo Check Reimbursement Policy", "HR Demo Submit Expense Claim", "HR Demo Create Claim OrangeHRM")

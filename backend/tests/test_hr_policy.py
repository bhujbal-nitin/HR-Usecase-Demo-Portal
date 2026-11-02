"""HR policy & documents: the knowledge-base client, the Q&A endpoint and the letters (the KM API replaced by fakes)."""

import base64
import io
import json
import re
import time
import zipfile
from datetime import date
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.core.exceptions import IntegrationError
from app.integrations.km import KnowledgeBaseClient
from app.schemas.employee import Employee, EmployeeStatus, OrangeHrmInfo
from app.services.hr_documents import HrDocuments
from app.services.hr_letters import fields_in, fill_letter, replace_in_letter, values_for


# ----------------------------------------------------------------------------------------------------- the KM client
def jwt(expires_in: float) -> str:
    claims = base64.urlsafe_b64encode(json.dumps({"exp": time.time() + expires_in}).encode()).decode().rstrip("=")
    return f"header.{claims}.signature"


class Response:
    def __init__(self, status=200, body=None):
        self.status_code, self._body = status, body
        self.ok = status < 400
        self.text = json.dumps(body) if body is not None else ""
        self.headers = {"content-type": "application/json"}

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class FakeSession:
    def __init__(self, *, tokens, answers):
        self.tokens, self.answers, self.calls = list(tokens), list(answers), []

    def get(self, url, headers=None, timeout=None):
        self.calls.append(("GET", url, headers))
        return self.tokens.pop(0)

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(("POST", url, json, headers))
        return self.answers.pop(0)


def client_with(session, **settings) -> KnowledgeBaseClient:
    values = {"_env_file": None, "km_project_id": "proj-1", "km_project_secret": "s3cret", **settings}
    client = KnowledgeBaseClient(Settings(**values))
    client._session = session  # noqa: SLF001 - test wiring
    return client


ANSWER = {"answer": "Yes [S1], you can [S2][S3].", "data_points": [
    {"filename": "Leave_Policy.pdf", "sourcepage": "Leave_Policy-2.pdf"}, {"filename": "Leave_Policy.pdf", "sourcepage": "Leave_Policy-3.pdf"},
    {"filename": "", "sourcepage": "Handbook-9.pdf"},
]}


def test_the_client_gets_a_token_with_the_project_credentials_and_asks_with_the_history():
    session = FakeSession(tokens=[Response(body={"token": jwt(3600)})], answers=[Response(body=ANSWER)])
    result = client_with(session).ask("and for contractors?", [("am i eligible", "Yes.")])
    assert result == {"answer": "Yes, you can.", "sources": ["Leave_Policy.pdf", "Handbook-9.pdf"]}  # the [S1] markers are gone; each source once
    method, url, headers = session.calls[0]
    assert (method, url) == ("GET", "https://ac2.automationedge.com/km/api/token") and headers == {"Project-Id": "proj-1", "Project-Secret": "s3cret"}
    _, url, body, headers = session.calls[1]
    assert url == "https://ac2.automationedge.com/km/api/query" and headers["Authorization"].startswith("Bearer header.")
    assert body["history"] == [{"user": "am i eligible", "bot": "Yes."}, {"user": "and for contractors?"}]
    assert body["overrides"]["retrieval_mode"] == "hybrid" and body["overrides"]["top"] == 3 and body["filters"] == []


def test_the_token_is_reused_until_it_is_about_to_expire_then_renewed():
    session = FakeSession(tokens=[Response(body={"token": jwt(3600)}), Response(body={"token": jwt(3600)})], answers=[Response(body=ANSWER)] * 3)
    client = client_with(session)
    client.ask("one", [])
    client.ask("two", [])
    assert [c[0] for c in session.calls] == ["GET", "POST", "POST"]  # one token for both questions
    client._token_expiry = time.time() + 30  # noqa: SLF001 - within the early-renewal margin
    client.ask("three", [])
    assert [c[0] for c in session.calls].count("GET") == 2


def test_a_plain_text_token_is_accepted():
    session = FakeSession(tokens=[Response(body=jwt(3600))], answers=[Response(body=ANSWER)])
    assert client_with(session).ask("q", [])["answer"] == "Yes, you can."


def test_without_credentials_the_client_says_it_is_not_configured():
    client = client_with(FakeSession(tokens=[], answers=[]), km_project_id="", km_project_secret="")
    assert not client.is_configured()
    with pytest.raises(IntegrationError, match="not configured"):
        client.ask("q", [])


def test_the_clients_failures_are_reported_plainly():
    with pytest.raises(IntegrationError, match="project id or secret was rejected"):
        client_with(FakeSession(tokens=[Response(401, {})], answers=[])).ask("q", [])
    with pytest.raises(IntegrationError, match="did not return a token"):
        client_with(FakeSession(tokens=[Response(body={})], answers=[])).ask("q", [])
    with pytest.raises(IntegrationError, match="could not answer"):
        client_with(FakeSession(tokens=[Response(body={"token": jwt(3600)})], answers=[Response(500, {"error": "boom"})])).ask("q", [])
    with pytest.raises(IntegrationError, match="did not return an answer"):
        client_with(FakeSession(tokens=[Response(body={"token": jwt(3600)})], answers=[Response(body={"answer": " [S1] "})])).ask("q", [])


def test_a_refused_token_is_dropped_so_the_next_question_gets_a_new_one():
    session = FakeSession(tokens=[Response(body={"token": jwt(3600)}), Response(body={"token": jwt(3600)})], answers=[Response(401, {}), Response(body=ANSWER)])
    client = client_with(session)
    with pytest.raises(IntegrationError, match="refused the token"):
        client.ask("q", [])
    assert client.ask("q", [])["answer"] == "Yes, you can."
    assert [c[0] for c in session.calls].count("GET") == 2


# ---------------------------------------------------------------------------------------------------------- the letters
WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def run(text: str) -> str:
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def make_docx(*paragraphs: str) -> bytes:
    """A small Word file: the given paragraphs (each a string of runs), an image run that must survive, and a part that must be copied as it is."""
    body = "".join(f"<w:p><w:pPr/>{p}</w:p>" for p in paragraphs)
    document = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body>{body}</w:body></w:document>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", document)
        z.writestr("word/media/logo.bin", b"\x00\x01 binary logo \xff")
    return out.getvalue()


def text_of(docx: bytes) -> str:
    xml = zipfile.ZipFile(io.BytesIO(docx)).read("word/document.xml").decode("utf-8")
    paragraphs = re.findall(r"<w:p>.*?</w:p>", xml, flags=re.S)
    return "\n".join("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p)).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&") for p in paragraphs)


def an_employee(**changes) -> Employee:
    values = dict(
        id="AE-373242", full_name="Varun Chopra", email="v@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20), aadhaar="234567890123",
        emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Quality Assurance", job_title="Lead Automation QA Engineer",
        manager="Amit D", start_date=date(2026, 4, 1), annual_ctc=1_200_000, hardware="MacBook", status=EmployeeStatus.APPROVED,
        orange_hrm=OrangeHrmInfo(emp_number=99, employee_id="373242"),
    )
    return Employee(**{**values, **changes})


TODAY = date(2026, 10, 30)


def test_the_fields_are_filled_even_when_word_split_them_over_runs():
    template = make_docx(
        run("This is to certify that &lt;&lt;First Name&gt;") + run("&gt;  &lt;") + run("&lt;Last Name&gt;&gt; ") + run("works as &lt;&lt;designation&gt;&gt; for &lt;&lt;Function&gt;&gt;"),
        run("Date: &lt;&lt;Today’s date&gt;&gt;") + run(" | Code &lt;&lt; Employee Code &gt;&gt;"),
    )
    filled = fill_letter(template, values_for(an_employee(), TODAY))
    assert text_of(filled).split("\n") == [
        "This is to certify that Varun  Chopra works as Lead Automation QA Engineer for Quality Assurance",
        "Date: 30-10-2026 | Code AE373242",
    ]
    assert "<<" not in text_of(filled)
    assert fields_in(template) == ["First Name", "Last Name", "designation", "Function", "Today’s date", "Employee Code"]


def test_everything_that_is_not_a_field_is_left_exactly_as_it_was():
    template = make_docx("<w:r><w:drawing>LOGO</w:drawing></w:r>" + run("Hello &lt;&lt;Employee Name&gt;&gt;, welcome."))
    filled = fill_letter(template, values_for(an_employee(full_name="Tom & Jerry <Jr>"), TODAY))
    xml = zipfile.ZipFile(io.BytesIO(filled)).read("word/document.xml").decode("utf-8")
    assert "<w:drawing>LOGO</w:drawing>" in xml  # the image run is untouched
    assert "Hello Tom &amp; Jerry &lt;Jr&gt;, welcome." in xml  # the name is escaped for XML
    assert zipfile.ZipFile(io.BytesIO(filled)).read("word/media/logo.bin") == b"\x00\x01 binary logo \xff"  # other parts are copied as they are


def test_gendered_wording_is_made_neutral():
    template = make_docx(run("His employee code is &lt;&lt;Employee Code&gt;&gt;."))
    assert text_of(fill_letter(template, values_for(an_employee(), TODAY))) == "The employee code is AE373242."


def test_a_letter_is_never_sent_half_filled():
    with pytest.raises(Exception, match="field <<Blood Group>> that the portal does not know"):
        fill_letter(make_docx(run("&lt;&lt;Blood Group&gt;&gt;")), values_for(an_employee(), TODAY))
    with pytest.raises(Exception, match="no <<fields>>"):
        fill_letter(make_docx(run("Mr. xyz is employed")), values_for(an_employee(), TODAY))
    with pytest.raises(Exception, match="not a valid Word"):
        fill_letter(b"not a zip", values_for(an_employee(), TODAY))


def test_the_values_come_from_the_employee_record():
    values = values_for(an_employee(), TODAY)
    assert (values["employee code"], values["ref no"], values["function"], values["designation"]) == ("AE373242", "AE373242", "Quality Assurance", "Lead Automation QA Engineer")
    assert (values["date"], values["today's date"], values["joining date"]) == ("30-10-2026", "30-10-2026", "01-04-2026")
    three = values_for(an_employee(full_name="Aarav Kumar Sharma"), TODAY)
    assert (three["first name"], three["last name"], three["employee name"]) == ("Aarav Kumar", "Sharma", "Aarav Kumar Sharma")
    assert values_for(an_employee(full_name="Cher"), TODAY)["last name"] == ""
    assert values_for(an_employee(orange_hrm=None), TODAY)["employee code"] == "AE373242"  # no OrangeHRM profile: the number of the portal ID


def test_sample_values_can_be_turned_into_fields():
    template = make_docx(run("Ref No: AE") + run("1234") + run("  Date: 25-03-") + run("2026"), run("Employee Code: AE1234"))
    edited = replace_in_letter(template, [("Ref No:", "AE1234", "<<Ref No>>"), ("Ref No:", "25-03-2026", "<<Date>>"), ("Employee Code:", "AE1234", "<<Employee Code>>")])
    assert text_of(edited).split("\n") == ["Ref No: <<Ref No>>  Date: <<Date>>", "Employee Code: <<Employee Code>>"]
    assert fields_in(edited) == ["Ref No", "Date", "Employee Code"]


def test_templates_are_found_by_name_as_word_files_only_and_missing_ones_say_so(tmp_path):
    documents = HrDocuments(tmp_path / "hr")
    folder = documents.folder
    assert [(l.key, l.available, l.file_name) for l in documents.letters()] == [("address-proof", False, None), ("bank-account", False, None)]
    with pytest.raises(Exception, match="address_proof_bonafide_letter.docx"):
        documents.template_of("address-proof")

    (folder / "Address_Proof_bonafide_letter.DOCX").write_bytes(b"PK")  # the case does not matter
    (folder / "Address_Proof_bonafide_letter_backup.docx").write_bytes(b"PK")  # a backup copy is not the template
    (folder / "~$dress_Proof_bonafide_letter.docx").write_bytes(b"lock")  # Word's temporary file is not the template
    (folder / "salary_account_opening_template.pdf").write_bytes(b"%PDF")  # only Word files are letters
    assert [(l.key, l.available, l.file_name) for l in documents.letters()] == [("address-proof", True, "Address_Proof_bonafide_letter.DOCX"), ("bank-account", False, None)]
    assert [l.file_name for l in documents.letters("Varun Chopra")] == ["Address_Proof_Letter_Varun_Chopra.docx", None]
    assert documents.template_of("address-proof").name == "Address_Proof_bonafide_letter.DOCX"
    with pytest.raises(Exception, match="not offered"):
        documents.template_of("salary-certificate")


# ------------------------------------------------------------------------------------------------------------ API
class FakeKnowledgeBase:
    def __init__(self):
        self.asked = []

    def ask(self, question, history):
        self.asked.append((question, history))
        return {"answer": f"Answer to: {question}", "sources": ["Leave_Policy.pdf"]}


@pytest.fixture
def world(client):
    container = client.app.state.container
    for ident, name, number, status in (("AE-111111", "Aarav Sharma", 77, EmployeeStatus.APPROVED), ("AE-333333", "Rohan Patil", 88, EmployeeStatus.REJECTED)):
        container.repository.add(Employee(
            id=ident, full_name=name, email=f"{ident.lower()}@example.com", phone="+91 98765 43210", dob=date(1995, 7, 20),
            aadhaar="234567890123", emergency_name="S", emergency_phone="+91 98765 00000", address="Pune 411045", department="Engineering",
            job_title="Engineer", manager="Amit D", start_date=date(2026, 1, 5), annual_ctc=1_200_000, hardware="MacBook", status=status,
            orange_hrm=OrangeHrmInfo(emp_number=number),
        ))
    km = FakeKnowledgeBase()
    container.hr_policy._km = km  # noqa: SLF001 - test wiring
    return client, SimpleNamespace(km=km, documents=container.hr_policy._documents)  # noqa: SLF001


def test_a_question_is_answered_with_its_sources_and_the_chat_history_is_sent_along(world):
    client, w = world
    first = client.post("/api/hr-policy/ask", json={"question": "am i eligible for promotion"}).json()
    assert first == {"answer": "Answer to: am i eligible for promotion", "sources": ["Leave_Policy.pdf"]}
    client.post("/api/hr-policy/ask", json={"question": "and the conditions?", "history": [{"question": "am i eligible for promotion", "answer": first["answer"]}]})
    assert w.km.asked == [("am i eligible for promotion", []), ("and the conditions?", [("am i eligible for promotion", "Answer to: am i eligible for promotion")])]


def test_a_bad_question_is_refused(world):
    client, _ = world
    assert client.post("/api/hr-policy/ask", json={"question": " "}).status_code == 422
    assert client.post("/api/hr-policy/ask", json={"question": "x" * 501}).status_code == 422
    assert client.post("/api/hr-policy/ask", json={"question": "ok question", "history": [{"question": "q", "answer": "a"}] * 11}).status_code == 422


def test_without_km_credentials_a_question_is_a_clear_bad_gateway(client):
    answer = client.post("/api/hr-policy/ask", json={"question": "am i eligible for promotion"})  # the test settings have no KM credentials
    assert answer.status_code == 502 and "not configured" in answer.json()["detail"]


def place(w, name: str, *paragraphs: str) -> None:
    (w.documents.folder / name).write_bytes(make_docx(*paragraphs))


def test_the_letters_list_says_which_templates_are_there(world):
    client, w = world
    assert [(l["key"], l["title"], l["available"]) for l in client.get("/api/hr-policy/letters").json()] == [
        ("address-proof", "Address proof letter", False), ("bank-account", "Bank account opening letter", False)]
    place(w, "address_proof_bonafide_letter.docx", run("Hello &lt;&lt;Employee Name&gt;&gt;"))
    assert client.get("/api/hr-policy/letters").json()[0] == {"key": "address-proof", "title": "Address proof letter", "available": True, "fileName": "address_proof_bonafide_letter.docx"}
    named = client.get("/api/hr-policy/letters", params={"ref": "AE-111111"}).json()  # with an employee: the name of their copy
    assert named[0]["fileName"] == "Address_Proof_Letter_Aarav_Sharma.docx" and named[1]["fileName"] is None
    assert client.get("/api/hr-policy/letters", params={"ref": "nobody@example.com"}).status_code == 404


def test_a_letter_is_made_for_the_employee_with_their_real_values(world):
    client, w = world
    place(w, "Address_Proof_bonafide_letter.docx", run("This is to certify that &lt;&lt;Employee Name&gt;&gt; (&lt;&lt;Employee Code&gt;&gt;), &lt;&lt;Designation&gt;&gt;, joined on &lt;&lt;Joining Date&gt;&gt;. Date: &lt;&lt;Date&gt;&gt;"))
    place(w, "Salary_Account_Opening_Template.docx", run("&lt;&lt;First Name&gt;&gt; &lt;&lt;Last Name&gt;&gt; works for &lt;&lt;Function&gt;&gt;. His employee code is &lt;&lt;Employee Code&gt;&gt;."))
    template_before = (w.documents.folder / "Address_Proof_bonafide_letter.docx").read_bytes()

    letter = client.get("/api/hr-policy/letters/address-proof/download", params={"ref": "AE-111111"})
    assert letter.status_code == 200 and letter.headers["content-type"] == WORD
    assert 'filename="Address_Proof_Letter_Aarav_Sharma.docx"' in letter.headers["content-disposition"]
    assert text_of(letter.content) == f"This is to certify that Aarav Sharma (AE111111), Engineer, joined on 05-01-2026. Date: {date.today():%d-%m-%Y}"
    bank = client.get("/api/hr-policy/letters/bank-account/download", params={"ref": "ae-111111"})
    assert text_of(bank.content) == "Aarav Sharma works for Engineering. The employee code is AE111111."
    assert 'filename="Bank_Account_Opening_Letter_Aarav_Sharma.docx"' in bank.headers["content-disposition"]
    assert (w.documents.folder / "Address_Proof_bonafide_letter.docx").read_bytes() == template_before  # the template is never changed


def test_a_letter_that_cannot_be_made_is_refused(world):
    client, w = world
    missing = client.get("/api/hr-policy/letters/address-proof/download", params={"ref": "AE-111111"})
    assert missing.status_code == 404 and "not available yet" in missing.json()["detail"]
    assert client.get("/api/hr-policy/letters/salary-certificate/download", params={"ref": "AE-111111"}).status_code == 404
    assert client.get("/api/hr-policy/letters/address-proof/download", params={"ref": "AE-333333"}).status_code == 409  # not onboarded
    assert client.get("/api/hr-policy/letters/address-proof/download", params={"ref": "nobody@example.com"}).status_code == 404
    place(w, "address_proof_bonafide_letter.docx", run("Dear &lt;&lt;Blood Group&gt;&gt;"))
    wrong = client.get("/api/hr-policy/letters/address-proof/download", params={"ref": "AE-111111"})
    assert wrong.status_code == 409 and "does not know" in wrong.json()["detail"]


def test_lookup_finds_an_onboarded_employee(world):
    client, _ = world
    assert client.get("/api/hr-policy/lookup", params={"ref": "ae-111111"}).json()["fullName"] == "Aarav Sharma"
    assert client.get("/api/hr-policy/lookup", params={"ref": "AE-333333"}).status_code == 409


# -------------------------------------------------------------------------------------------------------------- policies
POLICY_NAMES = ["AE Leave Policy", "AE Paternity Leave Policy", "AE Maternity Benefit Act", "AE Health and Safety Policy", "AE POSH Policy"]


def put_policies(folder, *names):
    (folder / "Policies").mkdir(parents=True, exist_ok=True)
    for name in names:
        (folder / "Policies" / f"{name}.pdf").write_bytes(b"%PDF-1.4 " + name.encode())


def test_the_policies_folder_is_listed_by_title_and_other_files_are_ignored(tmp_path):
    documents = HrDocuments(tmp_path / "hr")
    assert documents.policies() == []  # no folder yet
    put_policies(documents.folder, *POLICY_NAMES)
    (documents.policies_folder / "notes.txt").write_text("not a policy")
    (documents.policies_folder / "~$AE Leave Policy.pdf").write_bytes(b"lock")  # Word's temporary file
    assert [p.title for p in documents.policies()] == ["AE Health and Safety Policy", "AE Leave Policy", "AE Maternity Benefit Act", "AE Paternity Leave Policy", "AE POSH Policy"]
    assert documents.policies()[1].key == "ae-leave-policy" and documents.policies()[1].file_name == "AE Leave Policy.pdf"


@pytest.mark.parametrize("query, expected", [
    ("leave", ["AE Leave Policy", "AE Paternity Leave Policy"]),
    ("Leaves", ["AE Leave Policy", "AE Paternity Leave Policy"]),  # a plural still finds it
    ("what is the maternity policy", ["AE Maternity Benefit Act"]),  # filler words say nothing
    ("posh", ["AE POSH Policy"]),
    ("paternity leave", ["AE Paternity Leave Policy", "AE Leave Policy"]),  # the better match comes first
    ("holiday", []),
])
def test_policy_search_matches_the_words_in_the_titles(tmp_path, query, expected):
    documents = HrDocuments(tmp_path / "hr")
    put_policies(documents.folder, *POLICY_NAMES)
    assert [p.title for p in documents.search_policies(query)] == expected


def test_a_query_without_a_meaningful_word_lists_every_policy(tmp_path):
    documents = HrDocuments(tmp_path / "hr")
    put_policies(documents.folder, *POLICY_NAMES)
    for query in ("", "   ", "the policy", "show me all of the policies"):
        assert len(documents.search_policies(query)) == 5


def test_policies_are_searched_and_downloaded_through_the_api(world):
    client, w = world
    assert client.get("/api/hr-policy/policies").json() == []
    put_policies(w.documents.folder, *POLICY_NAMES)
    found = client.get("/api/hr-policy/policies", params={"query": "safety"}).json()
    assert found == [{"key": "ae-health-and-safety-policy", "title": "AE Health and Safety Policy", "fileName": "AE Health and Safety Policy.pdf"}]
    assert len(client.get("/api/hr-policy/policies").json()) == 5

    pdf = client.get("/api/hr-policy/policies/ae-health-and-safety-policy/download")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content == b"%PDF-1.4 AE Health and Safety Policy"
    assert "AE%20Health%20and%20Safety%20Policy.pdf" in pdf.headers["content-disposition"]  # the space is encoded in the header
    assert client.get("/api/hr-policy/policies/ae-no-such-policy/download").status_code == 404
    assert client.get("/api/hr-policy/policies/..%2F..%2Fsecret/download").status_code == 404  # only listed policies can be downloaded


# ------------------------------------------------------------------------------------------- AutomationEdge showcase workflows
class FakeAutomationEdge:
    def __init__(self, status="Complete"):
        self.status, self.ran = status, []

    def __getattr__(self, method):
        def run():
            self.ran.append(method)
            return SimpleNamespace(workflow_name=f"WF {method}", execution_status=self.status, ok=self.status == "Complete",
                                   automation_request_id=701, agent_name="agent-1", message="done", instance_url=None)
        return run


@pytest.mark.parametrize("key, method", [
    ("search-policy", "search_policy"), ("get-policy", "get_policy_document"), ("ask-question", "ask_policy_question"),
    ("address-proof-letter", "generate_address_proof_letter"), ("bank-account-letter", "generate_bank_account_letter"),
])
def test_each_showcase_workflow_runs_its_own_automationedge_workflow(world, key, method):
    client, _ = world
    ae = client.app.state.container.automationedge = FakeAutomationEdge()
    body = client.post(f"/api/hr-policy/workflows/{key}").json()
    assert ae.ran == [method]
    assert body["ok"] is True and body["status"] == "Complete" and body["automationRequestId"] == 701


def test_a_workflow_that_does_not_complete_is_reported_not_ok(world):
    client, _ = world
    client.app.state.container.automationedge = FakeAutomationEdge("Failure")
    body = client.post("/api/hr-policy/workflows/search-policy").json()
    assert body["ok"] is False and body["status"] == "Failure"


def test_an_unknown_workflow_is_404_and_unconfigured_automationedge_is_a_clear_error(world):
    client, _ = world
    assert client.post("/api/hr-policy/workflows/nope").status_code == 404
    response = client.post("/api/hr-policy/workflows/search-policy")  # the test settings have no AutomationEdge credentials
    assert response.status_code == 502 and "not configured" in response.json()["detail"]


def test_the_workflow_names_come_from_the_settings(settings):
    assert (settings.ae_workflow_search_policy, settings.ae_workflow_get_policy, settings.ae_workflow_ask_policy,
            settings.ae_workflow_address_proof_letter, settings.ae_workflow_bank_account_letter) == (
        "HR Demo Search Policy", "HR Demo Get Policy Document", "HR Demo Ask Policy Question",
        "HR Demo Generate Address Proof Letter", "HR Demo Generate Bank Account Opening Letter")

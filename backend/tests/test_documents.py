"""Document verification: name matching, the checks, and the API (OpenAI is replaced by a fake reader)."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.document_verification_service import DocumentVerificationService, name_similarity

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"


class FakeReader:
    def __init__(self, answer: dict | None = None):
        self.answer = answer or {}
        self.calls = 0

    def is_configured(self) -> bool:
        return True

    def read(self, filename, content, content_type):
        self.calls += 1
        return self.answer


def make_service(answer: dict, threshold: float = 0.85) -> DocumentVerificationService:
    settings = Settings(_env_file=None, document_name_match_threshold=threshold)
    return DocumentVerificationService(settings, FakeReader(answer))


AADHAAR = {"documentType": "aadhaar", "readable": True, "looksGenuine": True, "holderName": "Aarav Sharma", "dateOfBirth": "1995-07-20", "idNumber": "2345 6789 0123", "issues": []}
PAN = {"documentType": "pan", "readable": True, "looksGenuine": True, "holderName": "AARAV SHARMA", "dateOfBirth": "1995-07-20", "idNumber": "ABCDE1234F", "issues": []}
SLIP = {"documentType": "salary_slip", "readable": True, "looksGenuine": True, "holderName": "Aarav Sharma", "dateOfBirth": None, "idNumber": None, "issues": []}


@pytest.mark.parametrize(
    ("a", "b", "same"),
    [
        ("Aarav Sharma", "AARAV SHARMA", True),
        ("Aarav Kumar Sharma", "Aarav Sharma", True),  # a middle name on one side only
        ("Sharma Aarav", "Aarav Sharma", True),
        ("Mr. Aarav Sharma", "Aarav Sharma", True),
        ("Aarav Sharma", "Rohan Mehta", False),
    ],
)
def test_name_similarity(a, b, same):
    assert (name_similarity(a, b) >= 0.85) is same


def test_aadhaar_passes_and_never_returns_the_full_number():
    result = make_service(AADHAAR).verify("idDoc", "a.pdf", PDF, "application/pdf", "Aarav Sharma")
    assert result.passed and result.id_number_masked == "XXXX XXXX 0123"
    assert "2345" not in (result.id_number_masked or "")


def test_wrong_document_type_fails():
    result = make_service(PAN).verify("idDoc", "a.pdf", PDF, "application/pdf", "Aarav Sharma")
    assert not result.passed
    assert [c.id for c in result.checks] == ["type"] and "not an Aadhaar card" in result.checks[0].detail


def test_name_mismatch_fails():
    result = make_service(SLIP).verify("salaryDoc", "s.pdf", PDF, "application/pdf", "Rohan Mehta")
    assert not result.passed and result.checks[1].id == "name"


def test_pan_dob_must_match_the_aadhaar_dob():
    service = make_service(PAN)
    assert service.verify("panDoc", "p.pdf", PDF, "application/pdf", "Aarav Sharma", "1995-07-20").passed
    result = service.verify("panDoc", "p.pdf", PDF, "application/pdf", "Aarav Sharma", "1996-01-01")
    assert not result.passed and result.checks[-1].id == "dob"


def test_blurry_document_fails():
    blurry = {**AADHAAR, "readable": False, "issues": ["blurry"]}
    assert not make_service(blurry).verify("idDoc", "a.pdf", PDF, "application/pdf", "Aarav Sharma").passed


@pytest.fixture
def api(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path / "d", offers_dir=tmp_path / "o", approval_poller_enabled=False)
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, app


def test_status_is_off_without_a_key(api):
    client, _ = api
    assert client.get("/api/documents/verification").json() == {"enabled": False, "model": None}
    response = client.post("/api/documents/verify", data={"docKey": "idDoc", "fullName": "A B"}, files={"file": ("a.pdf", PDF, "application/pdf")})
    assert response.status_code == 502


def test_verify_endpoint_with_a_fake_reader(api):
    client, app = api
    service = app.state.container.document_verification
    service._reader = FakeReader(PAN)
    response = client.post(
        "/api/documents/verify",
        data={"docKey": "panDoc", "fullName": "Aarav Sharma", "referenceDob": "1995-07-20"},
        files={"file": ("pan.pdf", PDF, "application/pdf")},
    )
    body = response.json()
    assert response.status_code == 200 and body["passed"] is True and body["idNumberMasked"] == "ABXXXXXX4F"
    assert [c["id"] for c in body["checks"]] == ["type", "name", "dob"]


def test_verification_workflow_is_skipped_without_automationedge(api):
    client, _ = api
    body = client.post("/api/documents/verification-workflow").json()
    assert body["skipped"] is True and body["ok"] is False and body["workflowName"] == "HR Demo Document Verification"


@pytest.mark.parametrize(("status", "ok"), [("Complete", True), ("Failed", False)])
def test_verification_workflow_ok_only_when_complete(api, status, ok):
    from app.integrations.automationedge import WorkflowResult

    client, app = api
    ae = app.state.container.automationedge
    ae.is_configured = lambda: True
    ae.verify_documents = lambda: WorkflowResult("HR Demo Document Verification", 55, status, "agent1", "done", None)
    body = client.post("/api/documents/verification-workflow").json()
    assert body["ok"] is ok and body["status"] == status and body["automationRequestId"] == 55

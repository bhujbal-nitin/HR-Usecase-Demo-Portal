"""Request first, documents after: the candidate is registered without documents, the ServiceNow request is raised, and
each document is attached to it as it arrives (the agent demo's onboarding order)."""

import pytest

from app.core.exceptions import ConflictError, ValidationFailedError
from app.schemas.employee import CandidateCreate, IntakeStatus, StepStatus
from tests.conftest import PDF, wait_for
from tests.test_pipeline import FakeServiceNow, wired  # noqa: F401 - `wired` is a fixture


class RecordingServiceNow(FakeServiceNow):
    """The fake request system, plus what the staged flow adds: documents attached later, notes and the description list."""

    def __init__(self):
        super().__init__()
        self.notes: list[str] = []
        self.descriptions: list[list[str]] = []
        self.attach_warnings: list[str] = []

    def attach_document(self, emp, attachment):
        self.attachments.append(attachment.filename)
        return self.attach_warnings

    def add_request_note(self, emp, note):
        self.notes.append(note)

    def update_request_documents(self, emp, filenames):
        self.descriptions.append(list(filenames))


@pytest.fixture
def staged(wired):  # noqa: F811
    wired.onboarding._gw.servicenow = RecordingServiceNow()  # noqa: SLF001
    return wired


def _start(container, candidate_form):
    fields = {k: v for k, v in candidate_form.items() if k != "signature"}
    employee = container.onboarding.start(CandidateCreate.model_validate(fields))
    wait_for(lambda: container.repository.require(employee.id).intake_status != IntakeStatus.RUNNING)
    return container.repository.require(employee.id)


def _send_all(container, employee_id):
    for key, name in (("idDoc", "aadhaar.pdf"), ("panDoc", "pan.pdf"), ("salaryDoc", "salary.pdf")):
        container.onboarding.add_document(employee_id, key, name, PDF)


def test_start_raises_the_request_and_waits_for_documents(staged, candidate_form):
    employee = _start(staged, candidate_form)
    gw = staged.onboarding._gw  # noqa: SLF001

    assert employee.staged_intake and employee.documents == {}
    assert employee.intake_status == IntakeStatus.AWAITING_DOCUMENTS
    assert employee.service_now.req_number == "REQ0010001"
    steps = {s.key: s.status for s in employee.intake}
    assert steps == {"servicenow_request": StepStatus.SUCCESS, "candidate_details": StepStatus.PENDING}
    assert gw.servicenow.created == [employee.id]
    assert gw.automationedge.calls == []  # the candidate-details workflow waits for the documents


def test_documents_are_attached_to_the_request_and_noted(staged, candidate_form):
    employee = _start(staged, candidate_form)
    gw = staged.onboarding._gw  # noqa: SLF001

    updated = staged.onboarding.add_document(employee.id, "idDoc", "aadhaar.pdf", PDF)

    assert set(updated.documents) == {"idDoc"}
    assert updated.service_now.attached_documents == ["aadhaar.pdf"]
    assert gw.servicenow.attachments == ["aadhaar.pdf"]
    assert gw.servicenow.notes == ["Aadhaar Card received and attached (aadhaar.pdf)."]
    assert gw.servicenow.descriptions == [["aadhaar.pdf"]]
    assert staged.repository.require(employee.id).intake_status == IntakeStatus.AWAITING_DOCUMENTS


def test_a_document_sent_again_replaces_the_first_and_says_so(staged, candidate_form):
    employee = _start(staged, candidate_form)
    gw = staged.onboarding._gw  # noqa: SLF001
    staged.onboarding.add_document(employee.id, "idDoc", "aadhaar.pdf", PDF)

    again = staged.onboarding.add_document(employee.id, "idDoc", "aadhaar_correct.pdf", PDF)

    assert again.documents["idDoc"].filename == "aadhaar_correct.pdf"
    assert again.service_now.attached_documents == ["aadhaar.pdf", "aadhaar_correct.pdf"]
    assert "replaced by a new upload" in gw.servicenow.notes[-1]


def test_finishing_runs_the_candidate_workflow_and_then_approval_works(staged, candidate_form):
    employee = _start(staged, candidate_form)
    gw = staged.onboarding._gw  # noqa: SLF001
    _send_all(staged, employee.id)

    staged.onboarding.finish_documents(employee.id)
    done = wait_for(lambda: (e := staged.repository.require(employee.id)).intake_status == IntakeStatus.COMPLETED and e)

    assert [s.status for s in done.intake] == [StepStatus.SUCCESS, StepStatus.SUCCESS]
    assert gw.servicenow.created == [employee.id]  # the request is not raised a second time
    assert gw.automationedge.calls == ["details"]
    assert gw.servicenow.notes[-1].startswith("All required documents received")
    staged.onboarding.start_approval(employee.id)


def test_finishing_without_all_documents_is_refused(staged, candidate_form):
    employee = _start(staged, candidate_form)
    staged.onboarding.add_document(employee.id, "idDoc", "aadhaar.pdf", PDF)

    with pytest.raises(ValidationFailedError, match="PAN Card"):
        staged.onboarding.finish_documents(employee.id)
    assert staged.repository.require(employee.id).intake_status == IntakeStatus.AWAITING_DOCUMENTS


def test_approval_waits_until_the_documents_have_arrived(staged, candidate_form):
    employee = _start(staged, candidate_form)

    with pytest.raises(ConflictError, match="documents have not all arrived"):
        staged.onboarding.start_approval(employee.id)


def test_documents_are_only_accepted_while_the_candidate_is_sending_them(staged, candidate_form):
    employee = _start(staged, candidate_form)
    _send_all(staged, employee.id)
    staged.onboarding.finish_documents(employee.id)
    wait_for(lambda: staged.repository.require(employee.id).intake_status == IntakeStatus.COMPLETED)

    with pytest.raises(ConflictError, match="not waiting for documents"):
        staged.onboarding.add_document(employee.id, "idDoc", "aadhaar.pdf", PDF)


def test_a_bad_file_is_refused_and_not_attached(staged, candidate_form):
    employee = _start(staged, candidate_form)

    with pytest.raises(ValidationFailedError):
        staged.onboarding.add_document(employee.id, "idDoc", "aadhaar.txt", b"text")
    assert staged.onboarding._gw.servicenow.attachments == []  # noqa: SLF001


def test_the_outcome_of_a_document_check_becomes_a_work_note(staged, candidate_form):
    employee = _start(staged, candidate_form)
    gw = staged.onboarding._gw  # noqa: SLF001

    staged.onboarding.note_document_check(employee.id, "idDoc", False, ["The name does not match the form."])
    staged.onboarding.note_document_check("AE-000000", "idDoc", True, [])  # unknown candidate: nothing to note

    assert gw.servicenow.notes == ["Aadhaar Card checked by document scanning: did not pass. The name does not match the form."]


def test_a_wizard_submission_still_sends_everything_at_once(wired, candidate_form):
    from tests.test_pipeline import _submit

    employee = _submit(wired, candidate_form)

    assert not employee.staged_intake
    assert employee.intake_status == IntakeStatus.COMPLETED
    assert sorted(employee.service_now.attached_documents) == ["idDoc.pdf", "panDoc.pdf", "salaryDoc.pdf", "uanDoc.pdf"]


# ----------------------------------------------------------------------------------------------------- the HTTP API
def _api_start(client, candidate_form):
    fields = {k: v for k, v in candidate_form.items() if k != "signature"}
    response = client.post("/api/employees/start", data=fields)
    assert response.status_code == 201, response.text
    return response.json()


def test_api_start_then_send_documents_then_finish(client, candidate_form):
    body = _api_start(client, candidate_form)
    employee_id = body["id"]
    assert body["stagedIntake"] is True and body["documents"] == {}
    wait_for(lambda: client.get(f"/api/employees/{employee_id}").json()["intakeStatus"] == "awaiting_documents")

    for key in ("idDoc", "panDoc", "salaryDoc"):
        sent = client.post(f"/api/employees/{employee_id}/documents/{key}", files={"file": (f"{key}.pdf", PDF, "application/pdf")})
        assert sent.status_code == 200, sent.text
    assert sorted(client.get(f"/api/employees/{employee_id}").json()["documents"]) == ["idDoc", "panDoc", "salaryDoc"]

    finished = client.post(f"/api/employees/{employee_id}/finish-documents")
    assert finished.status_code == 202, finished.text
    wait_for(lambda: client.get(f"/api/employees/{employee_id}").json()["intakeStatus"] == "completed")


def test_api_rejects_a_document_that_is_not_a_pdf_or_word_file(client, candidate_form):
    employee_id = _api_start(client, candidate_form)["id"]
    wait_for(lambda: client.get(f"/api/employees/{employee_id}").json()["intakeStatus"] == "awaiting_documents")

    response = client.post(f"/api/employees/{employee_id}/documents/idDoc", files={"file": ("aadhaar.txt", b"text", "text/plain")})

    assert response.status_code == 422
    assert client.get(f"/api/employees/{employee_id}").json()["documents"] == {}


def test_api_cannot_finish_before_the_documents_are_in(client, candidate_form):
    employee_id = _api_start(client, candidate_form)["id"]
    wait_for(lambda: client.get(f"/api/employees/{employee_id}").json()["intakeStatus"] == "awaiting_documents")

    assert client.post(f"/api/employees/{employee_id}/finish-documents").status_code == 422
    assert client.post(f"/api/employees/{employee_id}/approve").status_code == 409

"""Pre-onboarding, in the order of the lifecycle: the offer, the acceptance, the personal details, the seven documents and the name check, the (dummy)
background check, HR's approval, the joining instructions and the completion (Gemini, ServiceNow and SMTP replaced by fakes)."""

import re
import smtplib
from dataclasses import dataclass, field
from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.core.exceptions import IntegrationNotConfiguredError
from app.integrations.mailer import Mailer
from app.schemas.preonboarding import DOCUMENT_KEYS, PreCandidate
from app.services.preonboarding.checks import EXPECTED_TYPE, names_match
from app.services.preonboarding.offer import indian_grouping
from app.services.preonboarding_service import PreOnboardingGateways

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
NAME = "Priya Anil Nair"
BASE = "/api/pre-onboarding/candidates"


# ------------------------------------------------------------------------------------------------------------ fakes
class FakeReader:
    """Answers like Gemini would: the right document of the right person, unless a test changes the answer for a file."""

    def __init__(self):
        self.overrides, self.calls = {}, []

    def is_configured(self):
        return True

    def read(self, filename, content, content_type, prompt=None):
        key = filename.rsplit(".", 1)[0].split("-")[0]
        self.calls.append((key, prompt))
        answer = {"documentType": EXPECTED_TYPE[key], "readable": True, "looksGenuine": True, "holderName": None if key == "photo" else NAME, "idNumber": None, "issues": []}
        answer.update(self.overrides.get(filename, {}))
        return answer


@dataclass
class FakeServiceNow:
    configured: bool = True
    notes: list = field(default_factory=list)
    attached: list = field(default_factory=list)
    events: list = field(default_factory=list)
    fail_create: bool = False

    def is_configured(self):
        return self.configured

    def create_prehire_request(self, candidate, summary):
        if self.fail_create:
            raise RuntimeError("ServiceNow: request failed")
        self.events.append("created")
        self.summary = summary
        return SimpleNamespace(req_number="REQ0010009", req_url="http://sn/req", req_sys_id="sys1", ritm_sys_id="ritm1")

    def attach_to_request(self, sys_id, attachment):
        self.attached.append(attachment.filename)

    def add_note_to_request(self, sys_id, note):
        self.notes.append(note)

    def reject_request(self, sys_id, name):
        self.events.append("rejected")

    def close_request(self, sys_id, note):
        self.events.append("closed")


@dataclass
class FakeMailer:
    configured: bool = True
    sent: list = field(default_factory=list)

    def is_configured(self):
        return self.configured

    def send(self, to, subject, html, attachment=None):
        if not self.configured:
            raise IntegrationNotConfiguredError("SMTP")
        self.sent.append((to, subject, attachment.name, attachment.read_bytes()))


@pytest.fixture
def world(client, settings):
    container = client.app.state.container
    reader, sn, mailer = FakeReader(), FakeServiceNow(), FakeMailer()
    container.preonboarding._gw = PreOnboardingGateways(settings=settings, servicenow=sn, reader=reader, mailer=mailer)
    return SimpleNamespace(client=client, reader=reader, sn=sn, mailer=mailer, settings=settings, service=container.preonboarding)


def start_body(**changes) -> dict:
    body = {
        "fullName": NAME, "email": "priya.nair@example.com", "phone": "+91 98200 11223", "designation": "Senior Frontend Engineer",
        "department": "Engineering", "manager": "Michael Torres", "location": "Pune", "annualCtc": 3450000, "joiningDate": date(2027, 1, 4).isoformat(),
    }
    return {**body, **changes}


def personal_body(**changes) -> dict:
    body = {
        "dateOfBirth": "1993-03-03", "gender": "Female", "maritalStatus": "Single", "currentAddress": "B-17, Green Park Society, Andheri East, Mumbai",
        "permanentAddress": "House 4, Kochi, Kerala", "emergencyName": "Anil Kumar Nair", "emergencyRelation": "Father", "emergencyPhone": "+91 98670 20772",
    }
    return {**body, **changes}


def create(w, **changes) -> dict:
    response = w.client.post(BASE, json=start_body(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def upload(w, candidate_id, key, filename=None, content=PDF):
    name = filename or f"{key}.pdf"
    return w.client.post(f"{BASE}/{candidate_id}/documents", data={"key": key}, files={"file": (name, content, "application/pdf")})


def upload_all(w, candidate_id):
    for key in DOCUMENT_KEYS:
        answer = upload(w, candidate_id, key)
        assert answer.status_code == 200 and answer.json()["accepted"], answer.text


STEPS = ["released", "offer", "sent", "accepted", "collecting", "verified", "hr", "approved", "joining", "completed"]


def at_state(w, state) -> str:
    """A candidate taken as far as ``state``: released | offer (letter made) | sent | accepted | collecting (personal details given) | verified | hr
    (background check done, waiting for HR) | approved | joining | completed."""
    candidate_id = create(w)["id"]
    url = f"{BASE}/{candidate_id}"
    todo = [
        ("offer", lambda: w.client.post(f"{url}/offer")),
        ("sent", lambda: w.client.post(f"{url}/dispatch")),
        ("accepted", lambda: w.client.post(f"{url}/accept")),
        ("collecting", lambda: w.client.post(f"{url}/personal", json=personal_body())),
        ("verified", lambda: (upload_all(w, candidate_id), w.client.post(f"{url}/verify"))[1]),
        ("hr", lambda: w.client.post(f"{url}/bgv")),
        ("approved", lambda: w.client.post(f"{url}/hr/approve")),
        ("joining", lambda: w.client.post(f"{url}/joining")),
        ("completed", lambda: w.client.post(f"{url}/complete")),
    ]
    for name, action in todo:
        if STEPS.index(state) < STEPS.index(name):
            break
        response = action()
        assert response.status_code == 200, (name, response.text)
    return candidate_id


def get(w, candidate_id) -> dict:
    return w.client.get(f"{BASE}/{candidate_id}").json()


def pdf_text(data: bytes) -> str:
    """The words in a letter's PDF (it is written uncompressed, so they can be read straight from the file)."""
    return b" ".join(re.findall(rb"\(([^)]*)\)\s*Tj", data)).decode("latin-1")


# ----------------------------------------------------------------------------------------------------------- names
def test_names_match_ignores_case_order_titles_and_accepts_initials_and_missing_middle_names():
    assert names_match("Priya Anil Nair", "PRIYA ANIL NAIR")
    assert names_match("Priya Anil Nair", "Nair, Priya Anil")
    assert names_match("Priya Anil Nair", "Priya Nair")  # no middle name
    assert names_match("Priya Anil Nair", "Priya A. Nair")  # an initial
    assert names_match("Priya Anil Nair", "Mrs. Priya Anil Nair")
    assert not names_match("Priya Anil Nair", "Sarah Jenkins")
    assert not names_match("Priya Anil Nair", None)
    assert not names_match("Priya Anil Nair", "Priya Sharma")


def test_indian_grouping():
    assert [indian_grouping(n) for n in (500, 12000, 345000, 3450000, 123456789)] == ["500", "12,000", "3,45,000", "34,50,000", "12,34,56,789"]


def test_there_are_seven_documents_and_no_cancelled_cheque():
    assert DOCUMENT_KEYS == ("tenth", "twelfth", "degree", "aadhaar", "pan", "photo", "resume") and "cheque" not in EXPECTED_TYPE


# ------------------------------------------------------------------------------------------------------ the start
def test_a_candidate_starts_with_the_offer_released_and_a_servicenow_request(world):
    body = create(world)
    assert body["id"].startswith("PRE-") and len(body["id"]) == 10 and body["status"] == "Offer released"
    assert body["fullName"] == NAME and body["annualCtc"] == 3450000 and body["documents"] == {} and body["verification"] is None and body["offer"] is None
    assert body["personal"] is None and body["acceptance"] is None and body["bgv"] is None and body["joining"] is None
    assert body["serviceNow"]["reqNumber"] == "REQ0010009" and body["serviceNow"]["error"] is None
    assert body["hr"]["status"] == "Pending" and "Passport photo" in world.sn.summary and "cheque" not in world.sn.summary.lower()
    assert world.client.get(BASE).json()[0]["id"] == body["id"]
    assert get(world, body["id"])["fullName"] == NAME
    assert world.client.get(f"{BASE}/PRE-000000").status_code == 404


def test_a_servicenow_problem_is_recorded_but_does_not_stop_the_candidate(world):
    world.sn.fail_create = True
    assert "request failed" in create(world)["serviceNow"]["error"]
    world.sn.fail_create, world.sn.configured = False, False
    assert "not configured" in create(world)["serviceNow"]["error"]


def test_the_start_form_is_validated(world):
    for changes in ({"email": "nope"}, {"fullName": " "}, {"annualCtc": 0}, {"joiningDate": "tomorrow"}):
        assert world.client.post(BASE, json=start_body(**changes)).status_code == 422


# ------------------------------------------------------------------------------------------------------------ offer
def test_the_offer_letter_is_made_first_and_once(world):
    candidate_id = create(world)["id"]
    url = f"{BASE}/{candidate_id}"
    assert world.client.get(f"{url}/offer/download").status_code == 404
    body = world.client.post(f"{url}/offer").json()
    assert body["offer"]["letterNo"].startswith(f"OFFER/{date.today().year}/") and body["offer"]["fileName"] == "Offer_Letter_Priya_Anil_Nair.pdf"
    assert body["offer"]["sentAt"] is None and body["status"] == "Offer released"  # no approval is needed, and nothing changed
    assert world.client.post(f"{url}/offer").json()["offer"]["letterNo"] == body["offer"]["letterNo"]  # asking again changes nothing
    download = world.client.get(f"{url}/offer/download")
    assert download.status_code == 200 and "attachment" in download.headers["content-disposition"] and download.headers["content-type"] == "application/pdf" and download.content.startswith(b"%PDF")
    text = pdf_text(download.content)
    for expected in (NAME, "Senior Frontend Engineer", "Engineering", "Michael Torres", "Pune", "04-01-2027", "34,50,000", "Thirty Four Lakh Fifty Thousand Rupees", "AutomationEdge Technologies", "LETTER OF EMPLOYMENT OFFER"):
        assert expected in text, expected
    assert "<<" not in text and "approved by HR" not in text and "documents have been verified" not in text and "date of joining" in text
    assert "Offer_Letter_Priya_Anil_Nair.pdf" in world.sn.attached


def test_each_offer_gets_its_own_letter_number(world):
    one, two = create(world)["id"], create(world)["id"]
    first = world.client.post(f"{BASE}/{one}/offer").json()["offer"]["letterNo"]
    second = world.client.post(f"{BASE}/{two}/offer").json()["offer"]["letterNo"]
    assert first != second and first.endswith("/0001") and second.endswith("/0002")


def test_dispatch_e_mails_the_offer_and_changes_nothing_else(world):
    candidate_id = at_state(world, "offer")
    url = f"{BASE}/{candidate_id}"
    body = world.client.post(f"{url}/dispatch", json={"to": "me@example.com"}).json()
    assert body["status"] == "Offer released" and body["offer"]["sentTo"] == "me@example.com" and body["offer"]["sentAt"] and body["completedAt"] is None
    assert len(world.mailer.sent) == 1
    to, subject, attachment, data = world.mailer.sent[0]
    assert (to, attachment) == ("me@example.com", "Offer_Letter_Priya_Anil_Nair.pdf") and "AutomationEdge" in subject and data.startswith(b"%PDF")
    assert "closed" not in world.sn.events  # the request stays open for the whole lifecycle
    assert world.client.post(f"{url}/dispatch").json()["offer"]["sentTo"] == "me@example.com" and len(world.mailer.sent) == 1  # not sent twice


def test_dispatch_goes_to_the_candidates_address_by_default(world):
    candidate_id = at_state(world, "offer")
    assert world.client.post(f"{BASE}/{candidate_id}/dispatch").json()["offer"]["sentTo"] == "priya.nair@example.com"
    assert world.mailer.sent[0][0] == "priya.nair@example.com"


def test_dispatch_needs_an_offer_and_a_working_mailer(world):
    released = create(world)["id"]
    assert world.client.post(f"{BASE}/{released}/dispatch").status_code == 409  # no letter yet
    offer = at_state(world, "offer")
    world.mailer.configured = False
    failed = world.client.post(f"{BASE}/{offer}/dispatch")
    assert failed.status_code == 502 and "SMTP" in failed.json()["detail"]
    after = get(world, offer)
    assert after["status"] == "Offer released" and after["offer"]["sentAt"] is None  # nothing was marked sent
    assert world.client.post(f"{BASE}/{offer}/dispatch", json={"to": "bad"}).status_code == 422
    world.mailer.configured = True
    assert world.client.post(f"{BASE}/{offer}/dispatch").json()["offer"]["sentAt"]


# ------------------------------------------------------------------------------------------------------ acceptance
def test_the_candidate_accepts_and_confirms_the_offered_date(world):
    candidate_id = at_state(world, "sent")
    body = world.client.post(f"{BASE}/{candidate_id}/accept").json()
    assert body["status"] == "Offer accepted" and body["acceptance"]["joiningDate"] == "2027-01-04" and body["acceptance"]["acceptedAt"]
    assert any("Offer accepted" in n for n in world.sn.notes)
    assert world.client.post(f"{BASE}/{candidate_id}/accept").status_code == 409  # only once


def test_the_candidate_can_confirm_a_different_joining_date(world):
    candidate_id = at_state(world, "sent")
    body = world.client.post(f"{BASE}/{candidate_id}/accept", json={"joiningDate": "2027-01-12"}).json()
    assert body["acceptance"]["joiningDate"] == "2027-01-12" and body["joiningDate"] == "2027-01-12"


@pytest.mark.parametrize(("joining", "message"), [("2020-01-01", "future"), ("2027-01-10", "Sunday is a weekly off")])
def test_a_past_or_sunday_joining_date_is_refused(world, joining, message):
    candidate_id = at_state(world, "sent")
    refused = world.client.post(f"{BASE}/{candidate_id}/accept", json={"joiningDate": joining})
    assert refused.status_code == 422 and message in refused.json()["detail"]
    assert get(world, candidate_id)["status"] == "Offer released" and get(world, candidate_id)["joiningDate"] == "2027-01-04"


def test_the_offer_must_have_been_sent_before_it_can_be_accepted(world):
    candidate_id = at_state(world, "offer")
    refused = world.client.post(f"{BASE}/{candidate_id}/accept")
    assert refused.status_code == 409 and "not been sent" in refused.json()["detail"]
    assert world.client.post(f"{BASE}/{create(world)['id']}/accept").status_code == 409  # no letter at all


# --------------------------------------------------------------------------------------------------- personal details
def test_personal_details_open_the_document_step(world):
    candidate_id = at_state(world, "accepted")
    body = world.client.post(f"{BASE}/{candidate_id}/personal", json=personal_body()).json()
    assert body["status"] == "Collecting documents" and body["personal"]["gender"] == "Female" and body["personal"]["dateOfBirth"] == "1993-03-03"
    assert body["personal"]["emergencyName"] == "Anil Kumar Nair" and body["personal"]["currentAddress"].startswith("B-17")
    assert any("Personal information" in n for n in world.sn.notes)
    assert world.client.post(f"{BASE}/{candidate_id}/personal", json=personal_body()).status_code == 409  # only once


@pytest.mark.parametrize(
    "changes",
    [
        {"dateOfBirth": "2999-01-01"}, {"dateOfBirth": date.today().isoformat()}, {"dateOfBirth": f"{date.today().year - 10}-01-01"},  # future / today / under 18
        {"gender": "Robot"}, {"maritalStatus": "Complicated"}, {"currentAddress": "abc"}, {"permanentAddress": "  "},
        {"emergencyPhone": "123"}, {"emergencyName": "A"}, {"emergencyRelation": " "},
    ],
)
def test_bad_personal_details_are_refused(world, changes):
    candidate_id = at_state(world, "accepted")
    assert world.client.post(f"{BASE}/{candidate_id}/personal", json=personal_body(**changes)).status_code == 422
    assert get(world, candidate_id)["status"] == "Offer accepted"


def test_personal_details_need_the_offer_accepted_first(world):
    assert world.client.post(f"{BASE}/{at_state(world, 'sent')}/personal", json=personal_body()).status_code == 409


# ------------------------------------------------------------------------------------------------------- documents
def test_documents_are_not_taken_before_the_personal_details(world):
    candidate_id = at_state(world, "accepted")
    assert upload(world, candidate_id, "pan").status_code == 409
    assert world.client.post(f"{BASE}/{candidate_id}/verify").status_code == 409


def test_a_document_that_passes_is_kept_attached_and_noted(world):
    candidate_id = at_state(world, "collecting")
    answer = upload(world, candidate_id, "aadhaar").json()
    assert answer["accepted"] and answer["document"]["check"] == {
        "passed": True, "readable": True, "documentType": "aadhaar", "nameOnDocument": NAME, "nameMatches": True, "issues": [],
    }
    assert answer["record"]["documents"]["aadhaar"]["label"] == "Aadhaar card" and answer["record"]["documents"]["aadhaar"]["fileName"] == "aadhaar.pdf"
    assert world.sn.attached[-1] == "aadhaar.pdf" and "Aadhaar card received and attached" in world.sn.notes[-1]
    assert "JSON" in world.reader.calls[0][1] and "Aadhaar" in world.reader.calls[0][1]
    download = world.client.get(f"{BASE}/{candidate_id}/documents/aadhaar/download")
    assert download.status_code == 200 and download.content == PDF and download.headers["content-disposition"].startswith("inline")


def test_the_photo_has_no_name_to_match_and_may_be_an_image(world):
    candidate_id = at_state(world, "collecting")
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    answer = world.client.post(f"{BASE}/{candidate_id}/documents", data={"key": "photo"}, files={"file": ("photo.png", png, "image/png")}).json()
    assert answer["accepted"] and answer["document"]["check"]["nameMatches"] is None and answer["document"]["check"]["nameOnDocument"] is None
    assert "illustrated" in world.reader.calls[0][1]  # a sample avatar counts as a photo


def test_a_wrong_or_unreadable_document_is_reported_and_not_kept(world):
    candidate_id = at_state(world, "collecting")
    world.reader.overrides["pan.pdf"] = {"documentType": "aadhaar"}
    wrong = upload(world, candidate_id, "pan").json()
    assert not wrong["accepted"] and "does not look like a pan card" in wrong["document"]["check"]["issues"][0].lower()
    assert wrong["record"]["documents"] == {}  # nothing was accepted
    world.reader.overrides["degree.pdf"] = {"readable": False, "issues": ["blurry"]}
    blurry = upload(world, candidate_id, "degree").json()
    assert not blurry["accepted"] and "not clear" in blurry["document"]["check"]["issues"][0] and "blurry" in blurry["document"]["check"]["issues"]
    world.reader.overrides["resume.pdf"] = {"looksGenuine": False}
    assert "genuine" in upload(world, candidate_id, "resume").json()["document"]["check"]["issues"][0]
    assert get(world, candidate_id)["documents"] == {}
    assert any("did not pass" in n for n in world.sn.notes)


def test_a_document_sent_again_replaces_the_earlier_one(world):
    candidate_id = at_state(world, "collecting")
    upload(world, candidate_id, "degree")
    answer = upload(world, candidate_id, "degree", filename="degree-new.pdf", content=PDF + b"\n% newer").json()
    assert answer["accepted"] and list(answer["record"]["documents"]) == ["degree"] and answer["record"]["documents"]["degree"]["fileName"] == "degree-new.pdf"
    assert world.client.get(f"{BASE}/{candidate_id}/documents/degree/download").content.endswith(b"% newer")
    assert "replaced by a new upload" in world.sn.notes[-1]


def test_bad_uploads_are_refused(world):
    candidate_id = at_state(world, "collecting")
    assert upload(world, candidate_id, "cheque").status_code == 422  # no longer one of the documents
    assert upload(world, candidate_id, "salary").status_code == 422
    assert upload(world, candidate_id, "pan", filename="pan.exe").status_code == 422
    assert upload(world, candidate_id, "pan", content=b"not a pdf").status_code == 422
    assert upload(world, candidate_id, "pan", content=b"").status_code == 422
    assert world.client.post(f"{BASE}/{candidate_id}/documents", data={"key": "pan"}).status_code == 422
    assert upload(world, "PRE-000000", "pan").status_code == 404


# --------------------------------------------------------------------------------------------------------- verify
def test_verify_needs_all_seven_documents(world):
    candidate_id = at_state(world, "collecting")
    upload(world, candidate_id, "pan")
    refused = world.client.post(f"{BASE}/{candidate_id}/verify")
    assert refused.status_code == 409 and "Still needed" in refused.json()["detail"] and "Aadhaar card" in refused.json()["detail"]


def test_verify_with_matching_names_keeps_the_candidate_at_the_document_step(world):
    candidate_id = at_state(world, "verified")
    body = get(world, candidate_id)
    assert body["status"] == "Collecting documents" and body["verification"]["allMatch"] is True  # the next step is the background check
    rows = body["verification"]["rows"]
    assert [r["key"] for r in rows] == list(DOCUMENT_KEYS) and all(r["matches"] for r in rows)
    assert next(r for r in rows if r["key"] == "photo")["name"] is None and next(r for r in rows if r["key"] == "pan")["name"] == NAME
    assert "all 7 documents" in world.sn.notes[-1]


def test_verify_with_a_different_name_stays_with_the_candidate_until_it_is_fixed(world):
    candidate_id = at_state(world, "collecting")
    world.reader.overrides["pan.pdf"] = {"holderName": "Sarah Jenkins"}
    upload_all(world, candidate_id)  # the document is the right type, so it is kept; the name is what differs
    body = world.client.post(f"{BASE}/{candidate_id}/verify").json()
    assert body["status"] == "Collecting documents" and body["verification"]["allMatch"] is False
    bad = [r for r in body["verification"]["rows"] if not r["matches"]]
    assert [r["key"] for r in bad] == ["pan"] and "Sarah Jenkins" in bad[0]["note"]
    assert world.client.post(f"{BASE}/{candidate_id}/bgv").status_code == 409  # not with a name that differs
    world.reader.overrides.pop("pan.pdf")
    fixed = upload(world, candidate_id, "pan").json()["record"]
    assert fixed["verification"] is None  # a new document clears the old result
    assert world.client.post(f"{BASE}/{candidate_id}/verify").json()["verification"]["allMatch"] is True


# ------------------------------------------------------------------------------------------------------------- bgv
def test_the_background_check_is_a_dummy_that_is_always_clear(world):
    candidate_id = at_state(world, "verified")
    body = world.client.post(f"{BASE}/{candidate_id}/bgv").json()
    assert body["status"] == "Awaiting HR approval" and body["bgv"]["status"] == "Clear" and body["bgv"]["checkedAt"]
    assert [c["name"] for c in body["bgv"]["checks"]] == ["Identity", "Education", "Employment", "Address"] and all(c["result"] == "Clear" for c in body["bgv"]["checks"])
    assert all(c["note"] for c in body["bgv"]["checks"]) and "B-17" in body["bgv"]["checks"][3]["note"]
    assert "Waiting for HR approval" in world.sn.notes[-1]
    assert world.client.post(f"{BASE}/{candidate_id}/bgv").status_code == 409  # only once


def test_the_background_check_needs_the_documents_to_have_passed_the_name_check(world):
    collecting = at_state(world, "collecting")
    upload_all(world, collecting)  # uploaded, but the names have not been checked yet
    assert world.client.post(f"{BASE}/{collecting}/bgv").status_code == 409
    assert world.client.post(f"{BASE}/{create(world)['id']}/bgv").status_code == 409


# ----------------------------------------------------------------------------------------------------------- HR
def test_hr_is_the_only_human_step_and_decides_after_the_background_check(world):
    candidate_id = at_state(world, "verified")
    url = f"{BASE}/{candidate_id}"
    assert world.client.post(f"{url}/hr/approve").status_code == 409  # the background check comes first
    world.client.post(f"{url}/bgv")
    approved = world.client.post(f"{url}/hr/approve", json={"note": "Welcome"}).json()
    assert approved["status"] == "Approved" and approved["hr"]["status"] == "Approved" and approved["hr"]["approver"] == "HR" and approved["hr"]["note"] == "Welcome"
    assert world.client.post(f"{url}/hr/reject").status_code == 409
    assert any("approved by HR" in n for n in world.sn.notes)
    assert world.client.post(f"{url}/review/approve").status_code == 404  # the reviewer step is gone


def test_a_rejection_by_hr_ends_it(world):
    candidate_id = at_state(world, "hr")
    rejected = world.client.post(f"{BASE}/{candidate_id}/hr/reject", json={"note": "Not a fit"}).json()
    assert rejected["status"] == "Rejected" and rejected["hr"]["status"] == "Rejected" and rejected["completedAt"] and "rejected" in world.sn.events
    assert world.client.post(f"{BASE}/{candidate_id}/hr/approve").status_code == 409
    assert world.client.post(f"{BASE}/{candidate_id}/joining").status_code == 409
    assert world.client.post(f"{BASE}/{candidate_id}/complete").status_code == 409


# ------------------------------------------------------------------------------------------------------ joining
def test_the_joining_instructions_are_made_and_e_mailed_after_hr_approves(world):
    candidate_id = at_state(world, "approved")
    url = f"{BASE}/{candidate_id}"
    assert world.client.get(f"{url}/joining/download").status_code == 404
    mails_before = len(world.mailer.sent)
    body = world.client.post(f"{url}/joining", json={"to": "me@example.com"}).json()
    assert body["status"] == "Joining confirmed" and body["completedAt"] is None
    assert body["joining"]["fileName"] == "Joining_Instructions_Priya_Anil_Nair.pdf" and body["joining"]["sentTo"] == "me@example.com" and body["joining"]["sentAt"]
    assert len(world.mailer.sent) == mails_before + 1
    to, subject, attachment, data = world.mailer.sent[-1]
    assert (to, attachment) == ("me@example.com", "Joining_Instructions_Priya_Anil_Nair.pdf") and "joining instructions" in subject.lower() and data.startswith(b"%PDF")
    assert "Joining_Instructions_Priya_Anil_Nair.pdf" in world.sn.attached and "closed" not in world.sn.events
    assert world.client.post(f"{url}/joining").json()["joining"]["sentTo"] == "me@example.com" and len(world.mailer.sent) == mails_before + 1  # not sent twice
    download = world.client.get(f"{url}/joining/download")
    assert download.status_code == 200 and "attachment" in download.headers["content-disposition"] and download.headers["content-type"] == "application/pdf"
    text = pdf_text(download.content)
    for expected in ("JOINING INSTRUCTIONS", NAME.split()[0], "Senior Frontend Engineer", "Engineering", "Michael Torres", "04-01-2027", "10:00 AM", "Pune", "Please bring", "passport-size", "AutomationEdge Technologies"):
        assert expected in text, expected


def test_the_joining_instructions_need_hr_approval_and_a_working_mailer(world):
    assert world.client.post(f"{BASE}/{at_state(world, 'hr')}/joining").status_code == 409  # HR has not approved
    approved = at_state(world, "approved")
    world.mailer.configured = False
    failed = world.client.post(f"{BASE}/{approved}/joining")
    assert failed.status_code == 502 and "SMTP" in failed.json()["detail"]
    after = get(world, approved)
    assert after["status"] == "Approved" and after["joining"] is None  # nothing was marked sent
    world.mailer.configured = True
    assert world.client.post(f"{BASE}/{approved}/joining").json()["status"] == "Joining confirmed"


# -------------------------------------------------------------------------------------------------------- complete
def test_completion_closes_the_servicenow_request(world):
    candidate_id = at_state(world, "joining")
    url = f"{BASE}/{candidate_id}"
    assert "closed" not in world.sn.events
    body = world.client.post(f"{url}/complete").json()
    assert body["status"] == "Completed" and body["completedAt"] and "closed" in world.sn.events and "Pre-onboarding completed" in world.sn.notes[-1]
    assert world.client.post(f"{url}/complete").json()["status"] == "Completed"  # asking again changes nothing
    assert world.sn.events.count("closed") == 1


def test_completion_needs_the_joining_instructions_first(world):
    assert world.client.post(f"{BASE}/{at_state(world, 'approved')}/complete").status_code == 409
    assert world.client.post(f"{BASE}/{create(world)['id']}/complete").status_code == 409


def test_the_whole_lifecycle_in_order(world):
    candidate_id = at_state(world, "completed")
    body = get(world, candidate_id)
    assert body["status"] == "Completed" and set(body["documents"]) == set(DOCUMENT_KEYS)
    assert all(body[k] for k in ("personal", "acceptance", "bgv", "joining", "offer", "verification")) and body["hr"]["status"] == "Approved"
    assert body["serviceNow"]["reqNumber"] == "REQ0010009" and world.sn.events == ["created", "closed"]


# ------------------------------------------------------------------------------------------------------------ clear
def test_clear_removes_finished_candidates_and_their_files(world):
    completed = at_state(world, "completed")
    rejected = at_state(world, "hr")
    world.client.post(f"{BASE}/{rejected}/hr/reject")
    waiting = at_state(world, "approved")
    assert (world.settings.preonboarding_dir / completed).is_dir()
    assert world.client.delete(BASE).json() == {"removed": 2}
    assert [c["id"] for c in world.client.get(BASE).json()] == [waiting]
    assert not (world.settings.preonboarding_dir / completed).exists() and not (world.settings.preonboarding_dir / rejected).exists()


# ------------------------------------------------------------------------------------------------- earlier records
LEGACY = {
    "id": "PRE-424242", "fullName": NAME, "email": "priya.nair@example.com", "phone": "+91 98200 11223", "designation": "Engineer", "department": "Engineering",
    "manager": "M", "location": "Pune", "annualCtc": 3450000, "joiningDate": "2027-01-04", "status": "Offer sent",
    "documents": {
        "cheque": {"key": "cheque", "label": "Cancelled cheque", "fileName": "cheque.pdf", "contentType": "application/pdf",
                   "check": {"passed": True, "readable": True, "documentType": "cancelled_cheque", "nameOnDocument": NAME, "nameMatches": True, "issues": []}},
    },
    "review": {"status": "Approved", "reviewer": "Document reviewer", "decidedAt": "2026-11-01T10:00:00", "note": None},
    "hr": {"status": "Approved", "approver": "HR", "decidedAt": "2026-11-02T10:00:00", "note": None},
    "offer": {"letterNo": "OFFER/2026/0001", "fileName": "Offer_Letter_Priya_Anil_Nair.pdf", "sentTo": "priya.nair@example.com", "sentAt": "2026-11-03T10:00:00"},
}


def test_records_made_by_the_earlier_flow_still_load_and_can_be_cleared(world):
    legacy = PreCandidate.model_validate(LEGACY)
    assert legacy.status.value == "Offer sent" and "cheque" in legacy.documents
    world.service._repo.add(legacy)
    listed = {c["id"]: c for c in world.client.get(BASE).json()}
    assert listed["PRE-424242"]["status"] == "Offer sent" and listed["PRE-424242"]["review"]["status"] == "Approved" and "cheque" in listed["PRE-424242"]["documents"]
    assert get(world, "PRE-424242")["personal"] is None
    waiting = create(world)["id"]
    assert world.client.delete(BASE).json() == {"removed": 1}
    assert [c["id"] for c in world.client.get(BASE).json()] == [waiting]


# ------------------------------------------------------------------------------------------------------------ mailer
def test_the_mailer_attaches_a_word_file_as_word_and_a_pdf_as_pdf(settings, tmp_path, monkeypatch):
    sent = []

    class FakeSmtp:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
            pass

        def login(self, *args):
            pass

        def send_message(self, message):
            sent.append(message)

    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    mailer = Mailer(settings.model_copy(update={"smtp_username": "a@b.c", "smtp_password": SecretStr("secret")}))
    word, pdf = tmp_path / "letter.docx", tmp_path / "letter.pdf"
    word.write_bytes(b"PKword")
    pdf.write_bytes(b"%PDF")
    mailer.send("x@y.z", "Subject", "<p>Hi</p>", word)
    mailer.send("x@y.z", "Subject", "<p>Hi</p>", pdf)
    types = [[(part.get_content_subtype(), part.get_filename()) for part in message.iter_attachments()] for message in sent]
    assert types == [[("vnd.openxmlformats-officedocument.wordprocessingml.document", "letter.docx")], [("pdf", "letter.pdf")]]

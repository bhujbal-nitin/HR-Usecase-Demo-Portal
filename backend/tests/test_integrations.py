"""Integration clients against a scripted HTTP session (no network)."""

import json

import pytest
import requests

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations import automationedge as ae_module
from app.integrations.automationedge import AutomationEdgeClient, _encrypt
from app.integrations.office365 import Office365Client
from app.integrations.servicenow import Attachment, ServiceNowClient
from app.schemas.employee import Employee


def make_response(status: int = 200, body=None, text: str = "") -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response._content = (json.dumps(body) if body is not None else text).encode()
    response.headers["Content-Type"] = "application/json"
    return response


class ScriptedSession:
    """Returns queued responses in order and records every call."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict]] = []
        self.verify = True

    def _next(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)

    def request(self, method, url, **kwargs):
        return self._next(method, url, **kwargs)

    def get(self, url, **kwargs):
        return self._next("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self._next("POST", url, **kwargs)


@pytest.fixture
def employee(candidate_form):
    fields = {k: v for k, v in candidate_form.items() if k != "signature"}
    from app.schemas.employee import CandidateCreate

    return Employee(id="AE-123456", **CandidateCreate.model_validate(fields).model_dump())


def test_ae_encryption_matches_the_original_node_implementation():
    # Vectors produced by the original orchestrator's `node -e` helper (AES-256-ECB, PKCS7, base64).
    assert _encrypt("Msp") == "OpmXxSXKJ0N11kSd1G8wbQ=="
    assert _encrypt("1700000000000:Msp@12345") == "6q7iqPSJKjbh9zt8cgzFbxShF8IigXO0e8u9jtLl7GQ="


def test_ae_not_configured_raises_without_retrying():
    client = AutomationEdgeClient(Settings(_env_file=None))
    with pytest.raises(IntegrationNotConfiguredError):
        client.authenticate()


def test_ae_execute_dispatches_and_polls_until_complete(monkeypatch, employee):
    monkeypatch.setattr(ae_module.time, "sleep", lambda _: None)
    settings = Settings(_env_file=None, ae_org_code="ORG", ae_username="u", ae_password="p", ae_user_id="UID")
    client = AutomationEdgeClient(settings)
    client._session = ScriptedSession(
        make_response(200, {"sessionToken": "tok"}),  # authenticate (?ep=true)
        make_response(200, {"automationRequestId": 42, "success": True}),  # execute
        make_response(200, {"status": "Executing", "agentName": "A1"}),  # poll 1
        make_response(200, {"status": "Complete", "agentName": "A1", "workflowResponse": '{"message": "all good"}'}),
    )

    result = client.create_ad_user(employee, "x@example.com")

    assert result.ok and result.automation_request_id == 42 and result.message == "all good"
    assert result.response == {"message": "all good"}  # the workflow's own result is captured
    assert result.instance_url == "https://t4.automationedge.com/#/workflowinstances/42"
    execute_call = client._session.calls[1]
    assert execute_call[1].endswith("/rest/execute")
    assert execute_call[2]["headers"]["X-session-token"] == "tok"
    params = {p["name"]: p["value"] for p in execute_call[2]["json"]["params"]}
    assert params == {"P_firstName": "Aarav", "P_lastName": "Sharma", "P_receiverEmailID": "x@example.com"}


def test_ae_rejected_dispatch_raises(monkeypatch):
    monkeypatch.setattr(ae_module.time, "sleep", lambda _: None)
    settings = Settings(_env_file=None, ae_org_code="ORG", ae_username="u", ae_password="p")
    client = AutomationEdgeClient(settings)
    client._session = ScriptedSession(
        make_response(200, {"sessionToken": "tok"}),
        make_response(200, {"success": False, "errorDetails": "Workflow not found"}),
    )
    with pytest.raises(IntegrationError, match="Workflow not found"):
        client.management_approval()


def test_ae_failed_instance_is_not_ok(monkeypatch):
    monkeypatch.setattr(ae_module.time, "sleep", lambda _: None)
    settings = Settings(_env_file=None, ae_org_code="ORG", ae_username="u", ae_password="p")
    client = AutomationEdgeClient(settings)
    client._session = ScriptedSession(
        make_response(200, {"sessionToken": "tok"}),
        make_response(200, {"automationRequestId": 9, "success": True}),
        make_response(200, {"status": "Failure"}),
    )
    assert client.management_approval().ok is False


def test_ae_workflow_still_running_after_the_timeout_is_not_a_success(monkeypatch):
    monkeypatch.setattr(ae_module.time, "sleep", lambda _: None)
    settings = Settings(_env_file=None, ae_org_code="ORG", ae_username="u", ae_password="p", ae_workflow_timeout_seconds=1)
    client = AutomationEdgeClient(settings)
    client._session = ScriptedSession(
        make_response(200, {"sessionToken": "tok"}),
        make_response(200, {"automationRequestId": 7, "success": True}),
        *[make_response(200, {"status": "Executing"}) for _ in range(200000)],
    )
    result = client.management_approval()
    assert result.ok is False and result.execution_status == "Executing"
    assert "did not finish within 1s" in result.message


def test_office365_creates_user_with_generated_password(employee):
    settings = Settings(_env_file=None, o365_tenant_id="t", o365_client_id="c", o365_client_secret="s",
                        o365_default_domain="corp.example")
    client = Office365Client(settings)
    client._session = ScriptedSession(
        make_response(200, {"access_token": "bearer", "expires_in": 3600}),
        make_response(404, {"error": {"message": "not found"}}),  # user does not exist yet
        make_response(201, {"id": "guid-1", "userPrincipalName": "aarav.sharma@corp.example", "displayName": "Aarav Sharma"}),
    )

    info = client.create_user(employee)

    assert info.user_principal_name == "aarav.sharma@corp.example" and not info.already_existed
    body = client._session.calls[2][2]["json"]
    assert body["passwordProfile"]["password"] == info.initial_password
    assert body["passwordProfile"]["forceChangePasswordNextSignIn"] is True
    assert info.initial_password != "Welcome@2026!Onboard"  # no shared default password


def test_office365_existing_user_does_not_report_a_password(employee):
    settings = Settings(_env_file=None, o365_tenant_id="t", o365_client_id="c", o365_client_secret="s",
                        o365_default_domain="corp.example")
    client = Office365Client(settings)
    client._session = ScriptedSession(
        make_response(200, {"access_token": "bearer", "expires_in": 3600}),
        make_response(200, {"id": "guid-1", "displayName": "Aarav Sharma"}),
    )
    info = client.create_user(employee)
    assert info.already_existed and info.initial_password is None


def test_servicenow_catalog_failure_falls_back_to_table_api(monkeypatch, employee):
    monkeypatch.setattr("app.integrations.servicenow.time.sleep", lambda _: None)
    settings = Settings(_env_file=None, sn_instance_url="https://dev.service-now.com/", sn_username="u",
                        sn_password="p", sn_catalog_item_sys_id="item")
    client = ServiceNowClient(settings)
    client._user_sys_id = "approver"
    client._session = ScriptedSession(
        make_response(403, {"error": {"message": "ACL"}}),  # catalog order_now denied
        make_response(201, {"result": {"number": "REQ1", "sys_id": "req-sys"}}),  # sc_request
        make_response(200, {"result": [{"number": "RITM1", "sys_id": "ritm-sys"}]}),  # RITM lookup
        make_response(200, {"result": {}}),  # RITM update
        make_response(200, {"result": {}}),  # request update
        make_response(201, {"result": {}}),  # approval task
        make_response(200, {"result": {}}),  # work note on request
        make_response(200, {"result": {}}),  # work note on item
        make_response(201, {"result": {"sys_id": "att-1"}}),  # attach to request
        make_response(201, {"result": {"sys_id": "att-2"}}),  # attach to item
    )

    request = client.create_onboarding_request(employee, [Attachment("id.pdf", b"%PDF", "application/pdf")])

    assert (request.req_number, request.ritm_number) == ("REQ1", "RITM1")
    notes = [c for c in client._session.calls if "work_notes" in str(c)]
    assert len(notes) == 2
    assert request.req_url == "https://dev.service-now.com/nav_to.do?uri=sc_request.do?sys_id=req-sys"
    assert request.attached == ["id.pdf"]
    assert any("catalog order failed" in w for w in request.warnings)
    assert client._session.calls[0][1].endswith("/items/item/order_now")


def test_servicenow_not_configured():
    with pytest.raises(IntegrationNotConfiguredError):
        ServiceNowClient(Settings(_env_file=None)).check_connection()


def _incident_client(*responses):
    settings = Settings(_env_file=None, sn_instance_url="https://dev.service-now.com/", sn_username="u", sn_password="p")
    client = ServiceNowClient(settings)
    client._session = ScriptedSession(*responses)
    return client


def test_servicenow_incident_gets_a_work_note_on_creation_and_resolution():
    client = _incident_client(
        make_response(201, {"result": {"number": "INC1", "sys_id": "inc-sys"}}),
        make_response(200, {"result": {}}),  # work note: created
        make_response(200, {"result": {}}),  # resolve
        make_response(200, {"result": {}}),  # work note: resolved
    )

    incident = client.create_incident("Offboarding: Jane", "details")
    client.resolve_incident(incident.sys_id, "Done")

    bodies = [c[2]["json"] for c in client._session.calls]
    assert "Ticket created from the HR Demo Portal" in bodies[1]["work_notes"]
    assert "Ticket resolved from the HR Demo Portal. Done" in bodies[3]["work_notes"]


def test_servicenow_incident_survives_a_failed_work_note():
    client = _incident_client(
        make_response(201, {"result": {"number": "INC1", "sys_id": "inc-sys"}}),
        make_response(403, {"error": {"message": "ACL"}}),  # work note denied
    )

    assert client.create_incident("Offboarding: Jane", "details").number == "INC1"


def _linked(employee):
    employee.service_now.req_sys_id, employee.service_now.ritm_sys_id = "req-sys", "ritm-sys"
    return employee


def test_servicenow_attaches_a_later_document_to_the_request_and_the_item(employee):
    client = _incident_client(make_response(201, {"result": {"sys_id": "a1"}}), make_response(201, {"result": {"sys_id": "a2"}}))

    warnings = client.attach_document(_linked(employee), Attachment("aadhaar.pdf", b"%PDF", "application/pdf"))

    assert warnings == []
    urls = [call[1] for call in client._session.calls]
    assert "table_name=sc_request&table_sys_id=req-sys" in urls[0]
    assert "table_name=sc_req_item&table_sys_id=ritm-sys" in urls[1]


def test_servicenow_attach_document_survives_one_failure_but_not_both(employee):
    one_fails = _incident_client(make_response(201, {"result": {"sys_id": "a1"}}), make_response(403, {"error": {"message": "ACL"}}))
    assert "sc_req_item" in one_fails.attach_document(_linked(employee), Attachment("a.pdf", b"%PDF", "application/pdf"))[0]

    both_fail = _incident_client(make_response(403, {"error": {"message": "ACL"}}), make_response(403, {"error": {"message": "ACL"}}))
    with pytest.raises(IntegrationError):
        both_fail.attach_document(_linked(employee), Attachment("a.pdf", b"%PDF", "application/pdf"))


def test_servicenow_request_without_documents_says_they_are_awaited(monkeypatch, employee):
    monkeypatch.setattr("app.integrations.servicenow.time.sleep", lambda _: None)
    client = _incident_client(
        make_response(201, {"result": {"number": "REQ1", "sys_id": "req-sys"}}),  # sc_request
        make_response(200, {"result": [{"number": "RITM1", "sys_id": "ritm-sys"}]}),  # RITM lookup
        make_response(200, {"result": {}}),  # RITM update
        make_response(200, {"result": {}}),  # request update
        make_response(201, {"result": {}}),  # approval task
        make_response(200, {"result": {}}),  # work note on request
        make_response(200, {"result": {}}),  # work note on item
    )
    client._user_sys_id = "approver"

    request = client.create_onboarding_request(employee, [])

    assert request.attached == []
    notes = [c[2]["json"]["work_notes"] for c in client._session.calls if "work_notes" in str(c[2])]
    assert len(notes) == 2 and "awaiting the Aadhaar card" in notes[0]
    descriptions = [c[2]["json"]["description"] for c in client._session.calls if "description" in c[2].get("json", {})]
    assert descriptions and all("(to be attached by the candidate)" in d for d in descriptions)

"""AutomationEdge (AE) T4 RPA client: authentication, workflow execution and status polling."""

import base64
import json
import logging
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations.http import build_session, error_text
from app.schemas.employee import Employee, WorkflowRun
from app.utils.retry import retry_on_failure

logger = logging.getLogger(__name__)
SYSTEM = "AutomationEdge"

# AutomationEdge's login endpoint (?ep=true) expects username/password encrypted
# with AES-256-ECB using the key shipped in its own web client. This is a
# protocol requirement of the AE server, not a secret of this application.
_AE_TEMPLATE_KEY = bytes.fromhex("F2879A436574537D0DD600CE69AF0D6531C7B7152A254DCBE18595B5600DE200")

_SUCCESS_STATES = {"Complete", "Completed"}
_TERMINAL_STATES = _SUCCESS_STATES | {"Failed", "Failure", "Error", "Aborted", "Terminated"}


@dataclass
class WorkflowResult:
    workflow_name: str
    automation_request_id: int | None
    execution_status: str
    agent_name: str
    message: str
    instance_url: str | None
    response: dict | None = None  # parsed `workflowResponse` returned by the workflow, if any

    @property
    def ok(self) -> bool:
        """Success means the instance reached 'Complete'. Still running after the wait limit counts as not ok."""
        return self.execution_status in _SUCCESS_STATES

    def to_run(self) -> WorkflowRun:
        return WorkflowRun(
            workflow_name=self.workflow_name,
            automation_request_id=self.automation_request_id,
            execution_status=self.execution_status,
            agent_name=self.agent_name or None,
            message=self.message,
            instance_url=self.instance_url,
            response=self.response,
        )


def _encrypt(plain: str) -> str:
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plain.encode("utf-8")) + padder.finalize()
    encryptor = Cipher(algorithms.AES(_AE_TEMPLATE_KEY), modes.ECB()).encryptor()  # noqa: S305 - dictated by AE
    return base64.b64encode(encryptor.update(padded) + encryptor.finalize()).decode("ascii")


class AutomationEdgeClient:
    def __init__(self, settings: Settings):
        self._s = settings
        self._session = build_session(settings.verify_ssl)
        self._token: str | None = None
        self._token_expiry = 0.0

    # ------------------------------------------------------------------ setup
    @property
    def server_url(self) -> str:
        return self._s.ae_server_url.rstrip("/")

    def is_configured(self) -> bool:
        return bool(self._s.ae_org_code and self._s.ae_username and self._s.ae_password.get_secret_value())

    def _require(self) -> None:
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

    def _instance_url(self, request_id: int | None) -> str | None:
        if not request_id:
            return None
        parts = urlsplit(self.server_url)
        return f"{parts.scheme}://{parts.netloc}/#/workflowinstances/{request_id}"

    # ------------------------------------------------------------------- auth
    @retry_on_failure(max_retries=2, initial_delay=1.5, giveup_on=(IntegrationNotConfiguredError,))
    def authenticate(self) -> str:
        self._require()
        if self._token and time.time() < self._token_expiry:
            return self._token

        username = self._s.ae_username
        password = self._s.ae_password.get_secret_value()
        headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}

        # 1. Encrypted credentials (?ep=true), then 2. plain form login as a fallback.
        encrypted_password = _encrypt(f"{int(time.time() * 1000)}:{password}")
        attempts = [
            (
                f"{self.server_url}/rest/authenticate?ep=true",
                {
                    "username": _encrypt(username),
                    "password": encrypted_password,
                    "pass": encrypted_password,
                    "captcha": "",
                },
            ),
            (f"{self.server_url}/rest/authenticate", {"username": username, "password": password, "captcha": ""}),
        ]
        last_error = "no token returned"
        for url, form in attempts:
            try:
                response = self._session.post(url, data=form, headers=headers, timeout=15)
                if response.ok:
                    body = response.json()
                    token = body.get("sessionToken") or body.get("token")
                    if token:
                        self._token = token
                        self._token_expiry = time.time() + 3300  # tokens last ~1h; renew early
                        return token
                last_error = error_text(response)
            except (requests.RequestException, ValueError) as exc:
                last_error = str(exc)
        raise IntegrationError(SYSTEM, f"authentication failed ({last_error})")

    def check_connection(self) -> str:
        self.authenticate()
        return "Authenticated"

    # -------------------------------------------------------------- execution
    def execute_workflow(self, workflow_name: str, params: dict[str, str], max_wait_seconds: int | None = None) -> WorkflowResult:
        """Dispatch a workflow and wait until it reaches a final state (or the configured timeout)."""
        max_wait_seconds = max_wait_seconds or self._s.ae_workflow_timeout_seconds
        token = self.authenticate()
        headers = {"Content-Type": "application/json", "Accept": "application/json", "X-session-token": token}
        payload = {
            "orgCode": self._s.ae_org_code,
            "workflowName": workflow_name,
            "userId": self._s.ae_user_id,
            "source": self._s.ae_source,
            "sourceId": f"SID_{int(time.time() * 1000)}_{uuid.uuid4().hex[:12]}",
            "params": [
                {"name": name, "value": "" if value is None else str(value), "type": "String",
                 "uiControlType": "TextBox", "order": order, "secret": False}
                for order, (name, value) in enumerate(params.items(), start=1)
            ],
        }
        try:
            response = self._session.post(f"{self.server_url}/rest/execute", json=payload, headers=headers, timeout=30)
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"'{workflow_name}' dispatch failed: {exc}") from exc
        if not response.ok:
            raise IntegrationError(SYSTEM, f"'{workflow_name}' dispatch rejected - {error_text(response)}")

        body = response.json()
        request_id = body.get("automationRequestId")
        dispatched = body.get("success", bool(request_id and request_id > 0))
        if not dispatched:
            detail = body.get("errorDetails") or body.get("message") or "unknown error"
            raise IntegrationError(SYSTEM, f"'{workflow_name}' was not accepted: {detail}")

        status, agent, message = "In Progress", "", f"'{workflow_name}' dispatched (request {request_id})"
        response_data = None
        if request_id and request_id > 0:
            status, agent, message, response_data = self._poll(request_id, headers, max_wait_seconds, status, message)
            if status not in _TERMINAL_STATES:
                message = f"'{workflow_name}' did not finish within {max_wait_seconds}s (last status: {status})"

        return WorkflowResult(
            workflow_name=workflow_name,
            automation_request_id=request_id,
            execution_status=status,
            agent_name=agent,
            message=message,
            instance_url=self._instance_url(request_id),
            response=response_data,
        )

    def _poll(self, request_id: int, headers: dict, max_wait: int, status: str, message: str) -> tuple[str, str, str, dict | None]:
        agent = ""
        response_data = None
        deadline = time.time() + max_wait
        time.sleep(2)
        while True:
            try:
                response = self._session.get(
                    f"{self.server_url}/rest/workflowinstances/{request_id}", headers=headers, timeout=10
                )
                if response.ok:
                    instance = response.json()
                    status = instance.get("status", status)
                    agent = instance.get("agentName", agent) or ""
                    raw = instance.get("workflowResponse")
                    if raw:
                        try:
                            parsed = json.loads(raw)
                            response_data = parsed if isinstance(parsed, dict) else {"value": parsed}
                            message = response_data.get("message") or message
                        except ValueError:
                            response_data = {"raw": str(raw)[:500]}
                    if status in _TERMINAL_STATES:
                        break
            except (requests.RequestException, ValueError) as exc:
                logger.warning("AE poll for request %s failed: %s", request_id, exc)
                break
            if time.time() >= deadline:
                break
            time.sleep(2)
        return status, agent, message, response_data

    # -------------------------------------------------- onboarding workflows
    def get_emp_details(self, emp: Employee) -> WorkflowResult:
        return self.execute_workflow(
            self._s.ae_workflow_get_emp_details,
            {"NAME": emp.full_name, "EMAIL": emp.email, "CONTACT": emp.phone},
        )

    def management_approval(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_management_approval, {})

    def create_ad_user(self, emp: Employee, receiver_email: str) -> WorkflowResult:
        return self.execute_workflow(
            self._s.ae_workflow_create_ad_account,
            {"P_firstName": emp.first_name, "P_lastName": emp.last_name, "P_receiverEmailID": receiver_email},
        )

    def create_o365_user(self) -> WorkflowResult:
        return self.execute_workflow(
            self._s.ae_workflow_o365_user_creation,
            {
                "TENANT_ID": self._s.o365_tenant_id,
                "CLIENT_ID": self._s.o365_client_id,
                "CLIENT_SECRET": self._s.o365_client_secret.get_secret_value(),
                "DEFAULT_DOMAIN": self._s.o365_default_domain,
            },
        )

    def add_emp_orangehrm(self, emp: Employee) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_add_emp_orangehrm, {"EMP_NAME": emp.full_name})

    def create_laptop_request(self, emp: Employee) -> WorkflowResult:
        return self.execute_workflow(
            self._s.ae_workflow_create_laptop_request,
            {"laptop_name": emp.hardware, "emp_name": emp.full_name},
        )

    # ------------------------------------------------- offboarding workflows
    def get_exit_details(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_get_exit_details, {})

    def exit_management_approval(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_exit_management_approval, {})

    def disable_ad_user(self, first_name: str, last_name: str, receiver_email: str) -> WorkflowResult:
        """Same parameters as the onboarding "AD user creation" workflow."""
        return self.execute_workflow(
            self._s.ae_workflow_ad_user_disable,
            {"P_firstName": first_name, "P_lastName": last_name, "P_receiverEmailID": receiver_email},
        )

    def offboard_o365_user(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_o365_user_offboarding, {})

    def terminate_emp_orangehrm(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_terminate_emp_orangehrm, {})

    def asset_return_request(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_asset_return_request, {})

    def exit_clearance(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_exit_clearance, {})

    def send_mail_offboarding(self, subject: str) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_send_mail_offboarding, {"subject": subject})

    def verify_documents(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_document_verification, {})

    # ------------------------------------------- leave & attendance workflows
    def leave_balance(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_leave_balance, {})

    def check_leave_request(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_leave_check, {})

    def assign_leave_orangehrm(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_assign_leave, {})

    def attendance_records(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_attendance_records, {})

    def add_punch_in_orangehrm(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_punch_in, {})

    def punch_out_orangehrm(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_punch_out, {})

    # ------------------------------------------------ reimbursement workflows
    def read_bill(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_read_bill, {})

    def check_reimbursement_policy(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_check_reimbursement_policy, {})

    def submit_expense_claim(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_submit_expense_claim, {})

    def create_claim_orangehrm(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_create_claim, {})

    # ------------------------------------------- HR policy & documents workflows
    def search_policy(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_search_policy, {})

    def get_policy_document(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_get_policy, {})

    def ask_policy_question(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_ask_policy, {})

    def generate_address_proof_letter(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_address_proof_letter, {})

    def generate_bank_account_letter(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_bank_account_letter, {})

    # ------------------------------------------------ payroll & salary workflows
    def fetch_salary_details(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_fetch_salary, {})

    def generate_payslip(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_generate_payslip, {})

    def generate_ctc_statement(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_generate_ctc, {})

    def generate_form16(self) -> WorkflowResult:
        return self.execute_workflow(self._s.ae_workflow_generate_form16, {})

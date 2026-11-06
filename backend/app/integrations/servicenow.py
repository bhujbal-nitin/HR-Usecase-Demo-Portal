"""ServiceNow Service Catalog / ITSM client (Table, Catalog and Attachment APIs)."""

import logging
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import requests

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations.http import DEFAULT_TIMEOUT, build_session, error_text
from app.schemas.employee import Employee
from app.utils.formatting import split_name

logger = logging.getLogger(__name__)
SYSTEM = "ServiceNow"


@dataclass
class Attachment:
    filename: str
    data: bytes
    content_type: str = "application/octet-stream"


@dataclass
class CatalogRequest:
    req_number: str | None
    ritm_number: str | None
    req_sys_id: str | None
    ritm_sys_id: str | None
    req_url: str | None
    ritm_url: str | None
    attached: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class Incident:
    number: str
    sys_id: str
    url: str


class ServiceNowClient:
    def __init__(self, settings: Settings):
        self._s = settings
        self._session = build_session(settings.verify_ssl)
        self._user_sys_id: str | None = None

    # ------------------------------------------------------------------ setup
    @property
    def instance_url(self) -> str:
        return self._s.sn_instance_url.rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.instance_url and self._s.sn_username and self._s.sn_password.get_secret_value())

    def _require(self) -> None:
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

    def _call(self, method: str, path: str, *, ok: tuple[int, ...] = (200, 201), **kwargs) -> dict:
        """Perform an authenticated JSON call and return the ``result`` payload."""
        self._require()
        headers = {"Accept": "application/json", **kwargs.pop("headers", {})}
        if "json" in kwargs:
            headers.setdefault("Content-Type", "application/json")
        try:
            response = self._session.request(
                method,
                f"{self.instance_url}{path}",
                auth=(self._s.sn_username, self._s.sn_password.get_secret_value()),
                headers=headers,
                timeout=kwargs.pop("timeout", DEFAULT_TIMEOUT),
                **kwargs,
            )
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"request failed: {exc}") from exc
        if response.status_code not in ok:
            raise IntegrationError(SYSTEM, f"{method} {path.split('?')[0]} -> {error_text(response)}")
        try:
            return response.json().get("result", {})
        except ValueError:
            return {}

    def record_url(self, table: str, sys_id: str) -> str:
        return f"{self.instance_url}/nav_to.do?uri={table}.do?sys_id={sys_id}"

    # ----------------------------------------------------------------- health
    def check_connection(self) -> str:
        self._call("GET", "/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id")
        return "Connected"

    def current_user_sys_id(self) -> str | None:
        if self._user_sys_id:
            return self._user_sys_id
        result = self._call(
            "GET",
            f"/api/now/table/sys_user?sysparm_query=user_name={quote(self._s.sn_username)}&sysparm_fields=sys_id",
        )
        if isinstance(result, list) and result:
            self._user_sys_id = result[0].get("sys_id")
        return self._user_sys_id

    # ------------------------------------------------------------ attachments
    def attach_file(self, table: str, sys_id: str, attachment: Attachment) -> None:
        self._call(
            "POST",
            f"/api/now/attachment/file?table_name={table}&table_sys_id={sys_id}"
            f"&file_name={quote(attachment.filename)}",
            data=attachment.data,
            headers={"Content-Type": attachment.content_type},
            timeout=60,
        )

    # --------------------------------------------------------------- creation
    def create_onboarding_request(self, emp: Employee, attachments: list[Attachment]) -> CatalogRequest:
        """Create the onboarding REQ + RITM, an approval task, and attach documents."""
        self._require()
        first, middle, last = split_name(emp.full_name)
        variables = {
            "employee_name": emp.full_name,
            "first_name": first,
            "middle_name": middle,
            "last_name": last,
            "employee_id": emp.id,
            "department": emp.department,
            "designation": emp.job_title,
            "joining_date": emp.start_date.isoformat(),
            "email_id": emp.email,
            "mobile_number": emp.phone,
            "dob": emp.dob.isoformat(),
            "address": emp.address,
            "emergency_contact": f"{emp.emergency_name} ({emp.emergency_phone})",
            "hardware": emp.hardware,
        }
        summary = self._candidate_summary(emp, [a.filename for a in attachments])

        warnings: list[str] = []
        req_number = req_sys_id = None

        # 1. Preferred: order the catalog item. Fallback: raw sc_request row.
        if self._s.sn_catalog_item_sys_id:
            try:
                order = self._call(
                    "POST",
                    f"/api/sn_sc/servicecatalog/items/{self._s.sn_catalog_item_sys_id}/order_now",
                    json={"sysparm_quantity": 1, "variables": variables},
                    timeout=30,
                )
                req_number = order.get("number") or order.get("request_number")
                req_sys_id = order.get("sys_id") or order.get("request_id")
            except IntegrationError as exc:
                warnings.append(f"catalog order failed, used Table API: {exc.message}")
                logger.warning("ServiceNow catalog order failed (%s); falling back to Table API", exc.message)
        if not req_sys_id:
            created = self._call(
                "POST",
                "/api/now/table/sc_request",
                json={
                    "short_description": f"Employee Onboarding & Document Verification - {emp.full_name} ({emp.id})",
                    "description": summary,
                    "approval": "requested",
                    "request_state": "requested",
                    "stage": "requested",
                    "state": "1",
                },
            )
            req_number, req_sys_id = created.get("number"), created.get("sys_id")
        if not req_sys_id:
            raise IntegrationError(SYSTEM, "request was created but ServiceNow returned no sys_id")

        # 2. The catalog workflow normally creates the RITM; otherwise create it.
        ritm_number, ritm_sys_id = self._ensure_ritm(req_sys_id, emp, summary, warnings)

        # 3. Describe the parent request for the approver.
        self._best_effort(
            warnings, "update request",
            lambda: self._call(
                "PUT", f"/api/now/table/sc_request/{req_sys_id}",
                json={
                    "short_description": f"HRMS Onboarding: {emp.full_name} ({emp.id}) submitted details & documents",
                    "description": summary,
                    "approval": "requested", "request_state": "requested", "stage": "requested", "state": "1",
                },
            ),
        )

        # 4. Approval task for the integration user.
        self._best_effort(warnings, "create approval task", lambda: self._create_approval_task(req_sys_id, emp))

        # 4b. Work note on the request and the item: who raised it and what it contains.
        if attachments:
            note = (
                f"Onboarding request created from the HR Demo Portal for {emp.full_name} ({emp.id}). "
                f"Details and {len(attachments)} verification document(s) submitted; awaiting HR verification and approval."
            )
        else:
            note = (
                f"Onboarding request created from the HR Demo Portal for {emp.full_name} ({emp.id}). "
                "Candidate details submitted; awaiting the Aadhaar card, PAN card and latest salary slip, which will be attached to this request."
            )
        for table, sys_id in (("sc_request", req_sys_id), ("sc_req_item", ritm_sys_id)):
            if sys_id:
                self._best_effort(warnings, f"work note on {table}", lambda t=table, s=sys_id: self._add_work_note(t, s, note))

        # 5. Documents on both the request and the item.
        attached: list[str] = []
        for attachment in attachments:
            for table, sys_id in (("sc_request", req_sys_id), ("sc_req_item", ritm_sys_id)):
                if not sys_id:
                    continue
                try:
                    self.attach_file(table, sys_id, attachment)
                    if attachment.filename not in attached:
                        attached.append(attachment.filename)
                except IntegrationError as exc:
                    warnings.append(f"attach {attachment.filename} to {table}: {exc.message}")

        return CatalogRequest(
            req_number=req_number,
            ritm_number=ritm_number,
            req_sys_id=req_sys_id,
            ritm_sys_id=ritm_sys_id,
            req_url=self.record_url("sc_request", req_sys_id),
            ritm_url=self.record_url("sc_req_item", ritm_sys_id) if ritm_sys_id else None,
            attached=attached,
            warnings=warnings,
        )

    @staticmethod
    def _candidate_summary(emp: Employee, filenames: list[str]) -> str:
        """The request description: the candidate's details and the documents attached so far."""
        doc_lines = "\n".join(f"  - {name}" for name in filenames) or "  (to be attached by the candidate)"
        return (
            f"Candidate Details:\n"
            f"  - Full Legal Name: {emp.full_name}\n  - Employee ID: {emp.id}\n"
            f"  - Department: {emp.department}\n  - Designation: {emp.job_title}\n"
            f"  - Date of Joining: {emp.start_date.isoformat()}\n  - Requested Workstation: {emp.hardware}\n"
            f"  - Residential Address: {emp.address}\n"
            f"  - Emergency Contact: {emp.emergency_name} ({emp.emergency_phone})\n\n"
            f"Uploaded Verification Documents:\n{doc_lines}\n\n"
            "HR Verification Action: review the documents and approve to proceed with provisioning."
        )

    # ---------------------------------------------------- documents after the request
    def attach_document(self, emp: Employee, attachment: Attachment) -> list[str]:
        """Attach one more document to the employee's existing request and item. Returns warnings (one place failed);
        raises when it could not be attached anywhere."""
        sn = emp.service_now
        warnings: list[str] = []
        attached = 0
        for table, sys_id in (("sc_request", sn.req_sys_id), ("sc_req_item", sn.ritm_sys_id)):
            if not sys_id:
                continue
            try:
                self.attach_file(table, sys_id, attachment)
                attached += 1
            except IntegrationError as exc:
                warnings.append(f"attach {attachment.filename} to {table}: {exc.message}")
        if not attached:
            raise IntegrationError(SYSTEM, "; ".join(warnings) or "no ServiceNow request is linked to this candidate")
        return warnings

    def add_request_note(self, emp: Employee, note: str) -> None:
        """A work note on the request and the item (a courtesy: it never fails the caller)."""
        sn = emp.service_now
        for table, sys_id in (("sc_request", sn.req_sys_id), ("sc_req_item", sn.ritm_sys_id)):
            if sys_id:
                self._note_quietly(table, sys_id, note)

    def update_request_documents(self, emp: Employee, filenames: list[str]) -> None:
        """Keep the "Uploaded Verification Documents" list in the description up to date (best effort)."""
        sn = emp.service_now
        summary = self._candidate_summary(emp, filenames)
        for table, sys_id in (("sc_request", sn.req_sys_id), ("sc_req_item", sn.ritm_sys_id)):
            if not sys_id:
                continue
            try:
                self._call("PUT", f"/api/now/table/{table}/{sys_id}", json={"description": summary})
            except IntegrationError as exc:
                logger.warning("ServiceNow description update on %s failed: %s", table, exc.message)

    def _ensure_ritm(self, req_sys_id: str, emp: Employee, summary: str, warnings: list[str]):
        ritm_number = ritm_sys_id = None
        time.sleep(0.5)  # give the catalog workflow a moment to create the item
        try:
            items = self._call(
                "GET", f"/api/now/table/sc_req_item?sysparm_query=request={req_sys_id}&sysparm_fields=sys_id,number"
            )
            if isinstance(items, list) and items:
                ritm_number, ritm_sys_id = items[0].get("number"), items[0].get("sys_id")
        except IntegrationError as exc:
            warnings.append(f"RITM lookup: {exc.message}")

        title = f"HRMS Onboarding & Document Verification - {emp.full_name} ({emp.id})"
        try:
            if ritm_sys_id:
                self._call(
                    "PUT", f"/api/now/table/sc_req_item/{ritm_sys_id}",
                    json={"short_description": title, "description": summary, "approval": "requested"},
                )
            else:
                body = {"request": req_sys_id, "short_description": title, "description": summary,
                        "approval": "requested", "state": "1"}
                if self._s.sn_catalog_item_sys_id:
                    body["cat_item"] = self._s.sn_catalog_item_sys_id
                created = self._call("POST", "/api/now/table/sc_req_item", json=body)
                ritm_number, ritm_sys_id = created.get("number"), created.get("sys_id")
        except IntegrationError as exc:
            warnings.append(f"RITM update/create: {exc.message}")
        return ritm_number, ritm_sys_id

    def _create_approval_task(self, req_sys_id: str, emp: Employee) -> None:
        approver = self.current_user_sys_id()
        if not approver:
            return
        self._call(
            "POST", "/api/now/table/sysapproval_approver",
            json={
                "sysapproval": req_sys_id,
                "document_id": req_sys_id,
                "source_table": "sc_request",
                "approver": approver,
                "state": "requested",
                "comments": f"{emp.full_name} ({emp.id}) submitted details and documents. Please verify and approve.",
            },
        )

    def _add_work_note(self, table: str, sys_id: str, note: str) -> None:
        self._call("PUT", f"/api/now/table/{table}/{sys_id}", json={"work_notes": note})

    @staticmethod
    def _best_effort(warnings: list[str], what: str, action) -> None:
        try:
            action()
        except IntegrationError as exc:
            warnings.append(f"{what}: {exc.message}")
            logger.warning("ServiceNow %s failed: %s", what, exc.message)

    # --------------------------------------------------------------- decisions
    def approve_request(self, req_sys_id: str) -> None:
        self._set_decision(req_sys_id, approved=True, comment="Approved by HR from the HR Demo Portal.")

    def reject_request(self, req_sys_id: str, candidate_name: str) -> None:
        self._set_decision(req_sys_id, approved=False, comment=f"Onboarding request for {candidate_name} rejected by HR.")

    def _set_decision(self, req_sys_id: str, *, approved: bool, comment: str) -> None:
        if approved:
            body = {"approval": "approved", "request_state": "in_process", "stage": "in_process"}
        else:
            body = {"approval": "rejected", "request_state": "closed_rejected", "stage": "closed_incomplete", "state": "4"}
        self._call("PUT", f"/api/now/table/sc_request/{req_sys_id}", json=body)
        try:
            self._add_work_note("sc_request", req_sys_id, comment)
        except IntegrationError as exc:
            logger.warning("ServiceNow work note failed: %s", exc.message)
        # Approver tasks are secondary; ServiceNow may already have closed them.
        try:
            tasks = self._call(
                "GET", f"/api/now/table/sysapproval_approver?sysparm_query=sysapproval={req_sys_id}&sysparm_fields=sys_id"
            )
            for task in tasks if isinstance(tasks, list) else []:
                self._call(
                    "PUT", f"/api/now/table/sysapproval_approver/{task['sys_id']}",
                    json={"state": "approved" if approved else "rejected", "comments": comment},
                )
        except IntegrationError as exc:
            logger.warning("ServiceNow approver task update failed: %s", exc.message)

    def get_request_approval(self, req_sys_id: str) -> tuple[str | None, str | None]:
        """Return (approval, number) for polling approvals made inside ServiceNow."""
        result = self._call(
            "GET", f"/api/now/table/sc_request/{req_sys_id}?sysparm_fields=sys_id,number,approval,request_state"
        )
        return result.get("approval"), result.get("number")

    # --------------------------------------------------------------- incidents
    def create_incident(self, short_description: str, description: str, category: str = "inquiry") -> Incident:
        """A plain ITSM incident, used for offboarding tickets (asset return, clearances, the umbrella request)."""
        return self._open_incident(
            {"short_description": short_description, "description": description, "category": category, "impact": "3", "urgency": "3"}
        )

    def resolve_incident(self, sys_id: str, note: str) -> None:
        self._call(
            "PUT", f"/api/now/table/incident/{sys_id}",
            json={"state": "6", "close_code": "Solved (Permanently)", "close_notes": note},
        )
        self._note_quietly("incident", sys_id, f"Ticket resolved from the HR Demo Portal. {note}")

    def create_hardware_incident(self, emp: Employee, description: str, orange_emp_number: int | None) -> Incident:
        suffix = f" (OrangeHRM #{orange_emp_number})" if orange_emp_number else ""
        return self._open_incident(
            {
                "short_description": f"IT Provisioning: Deploy {emp.hardware} for {emp.full_name}{suffix}",
                "description": description,
                "category": "Hardware",
                "impact": "2",
                "urgency": "2",
            }
        )

    def _open_incident(self, body: dict) -> Incident:
        """Create an incident and leave a work note saying the portal raised it."""
        created = self._call("POST", "/api/now/table/incident", json=body, timeout=30)
        number, sys_id = created.get("number"), created.get("sys_id")
        if not number or not sys_id:
            raise IntegrationError(SYSTEM, "incident was created but ServiceNow returned no number")
        self._note_quietly("incident", sys_id, f"Ticket created from the HR Demo Portal: {body['short_description']}")
        return Incident(number=number, sys_id=sys_id, url=self.record_url("incident", sys_id))

    def _note_quietly(self, table: str, sys_id: str, note: str) -> None:
        """A work note is a courtesy: if it cannot be written the ticket and the flow carry on."""
        try:
            self._add_work_note(table, sys_id, note)
        except IntegrationError as exc:
            logger.warning("ServiceNow work note on %s failed: %s", table, exc.message)

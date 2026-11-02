"""OrangeHRM 5.x client (web-session login + PIM REST API)."""

import base64
import logging
import re
from dataclasses import dataclass, field

import requests

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations.http import build_session, error_text
from app.integrations.orangehrm_claim import ClaimMixin
from app.integrations.orangehrm_leave import LeaveAttendanceMixin
from app.integrations.orangehrm_payroll import PayrollMixin
from app.schemas.employee import Employee, OrangeHrmInfo
from app.utils.formatting import split_name

logger = logging.getLogger(__name__)
SYSTEM = "OrangeHRM"
_UA = {"User-Agent": "Mozilla/5.0 (HR Demo Portal)"}

# Used only to fill city/state from the free-text address when it is recognisable.
_CITY_STATE = {
    "pune": ("Pune", "Maharashtra"),
    "mumbai": ("Mumbai", "Maharashtra"),
    "bengaluru": ("Bengaluru", "Karnataka"),
    "bangalore": ("Bengaluru", "Karnataka"),
    "hyderabad": ("Hyderabad", "Telangana"),
    "delhi": ("New Delhi", "Delhi"),
    "chennai": ("Chennai", "Tamil Nadu"),
}


@dataclass
class ProfileResult:
    info: OrangeHrmInfo
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # things left out on purpose (not failures)


class OrangeHRMClient(LeaveAttendanceMixin, PayrollMixin, ClaimMixin):
    def __init__(self, settings: Settings):
        self._s = settings

    @property
    def base_url(self) -> str:
        return self._s.orangehrm_base_url.rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.base_url and self._s.orangehrm_username and self._s.orangehrm_password.get_secret_value())

    def _require(self) -> None:
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

    def _login(self, connect_timeout: float = 15) -> requests.Session:
        """Web login; the resulting cookie authorises the /api/v2 endpoints. ``connect_timeout`` is how long to wait for the server to answer."""
        self._require()
        session = build_session(self._s.verify_ssl)
        session.headers.update(_UA)
        login_url = f"{self.base_url}/web/index.php/auth/login"
        try:
            page = session.get(login_url, timeout=(connect_timeout, 15))
            if page.status_code == 403:  # the web server itself refuses this computer: nothing to do with the user name or password
                raise IntegrationError(SYSTEM, (
                    "the server refused this computer (HTTP 403 Forbidden), so the portal cannot log in. It is not the user name or password: "
                    "ask whoever runs the OrangeHRM server to allow this computer's IP address, or check that you are on the right network / VPN."))
            token_match = re.search(r':token="&quot;([^&]+)&quot;"', page.text) or re.search(
                r'name="_token"\s+value="([^"]+)"', page.text
            )
            token = token_match.group(1) if token_match else ""
            session.post(
                f"{self.base_url}/web/index.php/auth/validate",
                data={"_token": token, "username": self._s.orangehrm_username,
                      "password": self._s.orangehrm_password.get_secret_value()},
                headers={"Referer": login_url},
                timeout=15,
            )
            probe = session.get(f"{self.base_url}/web/index.php/api/v2/pim/employees?limit=1", timeout=15)
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"login failed: {exc}") from exc
        if probe.status_code == 403:
            raise IntegrationError(SYSTEM, "the server refused the portal's request (HTTP 403 Forbidden) after the login. Check the user's permissions in OrangeHRM.")
        if not probe.ok:  # the login page sets a cookie even for bad credentials, so probe the API
            raise IntegrationError(SYSTEM, "login failed - check ORANGEHRM_USERNAME / ORANGEHRM_PASSWORD")
        return session

    def check_connection(self) -> str:
        self._login()
        return "Authenticated"

    def _api(self, session: requests.Session, method: str, path: str, **kwargs) -> dict:
        return self._request(session, method, path, **kwargs).get("data", {}) or {}

    def _request(self, session: requests.Session, method: str, path: str, **kwargs) -> dict:
        """The whole JSON answer (data and meta)."""
        try:
            response = session.request(method, f"{self.base_url}/web/index.php/api/v2/{path}", timeout=25, **kwargs)
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"{method} {path} failed: {exc}") from exc
        if not response.ok:
            raise IntegrationError(SYSTEM, f"{method} {path} -> {error_text(response)}{self._invalid_params(response)}")
        try:
            return response.json() or {}
        except ValueError:
            return {}

    @staticmethod
    def _invalid_params(response: requests.Response) -> str:
        """OrangeHRM's 422 names the rejected fields in error.data.invalidParamKeys; say which ones."""
        try:
            keys = response.json().get("error", {}).get("data", {}).get("invalidParamKeys") or []
        except (ValueError, AttributeError):
            return ""
        return f" (rejected: {', '.join(map(str, keys))})" if keys else ""

    # ---------------------------------------------------------------- profile
    def create_employee_profile(
        self, emp: Employee, work_email: str, documents: list[tuple[str, bytes, str]]
    ) -> ProfileResult:
        """Create the PIM profile and fill in details. Only the base create is fatal."""
        session = self._login()
        first, middle, last = split_name(emp.full_name)
        employee_id = re.sub(r"[^0-9A-Za-z]", "", re.sub(r"^(AE|EMP)", "", emp.id))[:10]

        person = {"firstName": first, "middleName": middle, "lastName": last or first}
        try:
            created = self._api(session, "POST", "pim/employees", json={**person, "employeeId": employee_id})
        except IntegrationError as exc:
            # The id we derive from the portal id may already be taken in OrangeHRM: let OrangeHRM assign its own.
            if "employeeId" not in exc.message:
                raise
            logger.warning("OrangeHRM rejected employeeId %s; retrying with an assigned id", employee_id)
            created = self._api(session, "POST", "pim/employees", json=person)
        emp_number = created.get("empNumber")
        if not emp_number:
            raise IntegrationError(SYSTEM, "profile was created but OrangeHRM returned no empNumber")
        assigned_id = created.get("employeeId", employee_id)

        warnings: list[str] = []
        notes: list[str] = []

        def attempt(label: str, method: str, path: str, payload: dict) -> None:
            try:
                self._api(session, method, path, json=payload)
            except IntegrationError as exc:
                warnings.append(f"{label}: {exc.message}")
                logger.warning("OrangeHRM %s failed: %s", label, exc.message)

        # Personal details: only data the candidate actually supplied (no invented gender / marital status).
        attempt("personal details", "PUT", f"pim/employees/{emp_number}/personal-details", {
            "firstName": first, "middleName": middle, "lastName": last or first,
            "employeeId": assigned_id, "otherId": emp.aadhaar, "birthday": emp.dob.isoformat(),
        })
        attempt("job details", "PUT", f"pim/employees/{emp_number}/job-details", {"joinedDate": emp.start_date.isoformat()})

        city, province = self._city_state(emp.address)
        pin = re.search(r"\b(\d{6})\b", emp.address)
        contact = {
            "street1": emp.address, "street2": "", "city": city, "province": province,
            "zipCode": pin.group(1) if pin else "", "countryCode": "IN",
            "mobile": emp.phone, "workEmail": work_email,
            "otherEmail": emp.email if emp.email.lower() != work_email.lower() else "",
        }
        contact_path = f"pim/employee/{emp_number}/contact-details"
        try:
            self._api(session, "PUT", contact_path, json=contact)
        except IntegrationError as exc:
            # OrangeHRM refuses an e-mail address another profile already uses. The profile exists, so save the rest of the
            # contact details without those e-mails and say so, instead of failing (a rerun would create a second profile).
            rejected = [k for k in ("workEmail", "otherEmail") if k in exc.message]
            if not rejected:
                warnings.append(f"contact details: {exc.message}")
                logger.warning("OrangeHRM contact details failed: %s", exc.message)
            else:
                attempt("contact details", "PUT", contact_path, {**contact, **{k: "" for k in rejected}})
                notes.append(f"{' and '.join(rejected)} not saved: OrangeHRM rejected it (probably already used by another profile)")
                logger.warning("OrangeHRM rejected %s for empNumber %s; saved the other contact details", rejected, emp_number)
        attempt("emergency contact", "POST", f"pim/employees/{emp_number}/emergency-contacts", {
            "name": emp.emergency_name, "relationship": "Family",
            "homePhone": "", "mobilePhone": emp.emergency_phone, "officePhone": "",
        })
        attempt("salary component", "POST", f"pim/employees/{emp_number}/salary-components", {
            "salaryComponent": "CTC", "salaryAmount": str(emp.annual_ctc), "currencyId": "INR",
        })

        attached: list[str] = []
        for filename, data, content_type in documents:
            try:
                self._api(session, "POST", f"pim/employees/{emp_number}/screen/personal/attachments", json={
                    "attachment": {"name": filename, "type": content_type, "size": len(data),
                                   "base64": base64.b64encode(data).decode("ascii")},
                    "description": filename,
                })
                attached.append(filename)
            except IntegrationError as exc:
                warnings.append(f"attach {filename}: {exc.message}")

        info = OrangeHrmInfo(
            emp_number=emp_number,
            employee_id=str(assigned_id),
            work_email=work_email,
            profile_url=f"{self.base_url}/web/index.php/pim/viewPersonalDetails/empNumber/{emp_number}",
            attached_documents=attached,
        )
        return ProfileResult(info=info, warnings=warnings, notes=notes)

    @staticmethod
    def _city_state(address: str) -> tuple[str, str]:
        lowered = address.lower()
        for key, value in _CITY_STATE.items():
            if key in lowered:
                return value
        return "", ""

    # ------------------------------------------------------------ termination
    def terminate_employee(self, emp_number: int | None, full_name: str, last_day: str, note: str) -> dict:
        """End the employment in PIM (the profile stays as a past employee). ``emp_number`` may be unknown."""
        session = self._login()
        if not emp_number:
            emp_number = self._find_emp_number(session, full_name)
        reason_id = self._termination_reason_id(session)
        self._api(
            session, "POST", f"pim/employees/{emp_number}/terminations",
            json={"date": last_day, "terminationReasonId": reason_id, "note": note[:250]},
        )
        return {"empNumber": emp_number, "terminationDate": last_day, "profileUrl": f"{self.base_url}/web/index.php/pim/viewPersonalDetails/empNumber/{emp_number}"}

    def _find_emp_number(self, session: requests.Session, full_name: str) -> int:
        found = self._api(session, "GET", "pim/employees", params={"nameOrId": full_name, "limit": 10})
        wanted = " ".join(full_name.lower().split())
        for item in found if isinstance(found, list) else []:
            parts = [item.get("firstName"), item.get("middleName"), item.get("lastName")]
            if " ".join(" ".join(p.strip() for p in parts if p and p.strip()).lower().split()) == wanted:
                return item["empNumber"]
        raise IntegrationError(SYSTEM, f"no OrangeHRM profile named {full_name} was found")

    def _termination_reason_id(self, session: requests.Session) -> int:
        """The id of the 'Resigned' reason (created if the instance has none with that name)."""
        reasons = self._api(session, "GET", "pim/termination-reasons", params={"limit": 100})
        for item in reasons if isinstance(reasons, list) else []:
            if str(item.get("name", "")).strip().lower() in {"resigned", "resignation"}:
                return item["id"]
        created = self._api(session, "POST", "pim/termination-reasons", json={"name": "Resigned"})
        if not created.get("id"):
            raise IntegrationError(SYSTEM, "could not find or create the termination reason 'Resigned'")
        return created["id"]

    # ------------------------------------------------------------- directory
    def list_employee_names(self, limit: int = 50) -> set[str]:
        """Lower-cased full names of existing employees (used to keep demo data unique)."""
        session = self._login()
        names: set[str] = set()
        response = session.get(f"{self.base_url}/web/index.php/api/v2/pim/employees?limit={limit}", timeout=15)
        for item in response.json().get("data", []) if response.ok else []:
            parts = [item.get("firstName"), item.get("middleName"), item.get("lastName")]
            name = " ".join(p.strip() for p in parts if p and p.strip())
            if name:
                names.add(name.lower())
        return names

"""Asking for access from the login page: a person gives their name and e-mail, an admin approves or rejects, and the answer goes to that e-mail.

Approving makes the user (a normal user with the default login access unless the admin changes it) and e-mails the user name and a generated password.
"""

import html
import logging
import re
import secrets
import threading
import time
from datetime import datetime

from app.core.config import Settings
from app.core.exceptions import AppError, ConflictError, IntegrationError, NotFoundError, ValidationFailedError
from app.integrations.mailer import Mailer
from app.repositories.access_request_repository import AccessRequestRepository
from app.repositories.user_repository import UserRepository
from app.services.user_admin_service import UserAdminService

logger = logging.getLogger(__name__)

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE = re.compile(r"^[0-9+()\-.\s]{6,30}$")
PER_HOUR = 5  # sign-up requests one address (computer) may send in an hour
MAX_PENDING = 200


class TooManyRequests(AppError):
    status_code = 429


class SignupUnavailable(AppError):
    status_code = 503


def request_view(row: dict) -> dict:
    def iso(value):
        return value.isoformat() if value else None

    return {
        "id": row["id"], "email": row["email"], "fullName": row["full_name"], "status": row["status"],
        "requestedAt": iso(row["requested_at"]), "decidedAt": iso(row["decided_at"]), "decidedBy": row["decided_by"], "username": row["username"],
        "phone": row.get("phone", ""), "country": row.get("country", ""),
    }


class AccessRequestService:
    def __init__(self, settings: Settings, repository: AccessRequestRepository | None, users: UserRepository, user_admin: UserAdminService, mailer: Mailer):
        self._settings = settings
        self._repo = repository
        self._users = users
        self._admin = user_admin
        self._mailer = mailer
        self._seen: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def start_schema(self) -> None:
        if self._repo is None:
            return
        try:
            self._repo.ensure_schema()
        except Exception as exc:  # noqa: BLE001 - a database that is down must not stop the portal
            logger.error("Access request table is not ready: %s", exc)

    def _store(self) -> AccessRequestRepository:
        if self._repo is None:
            raise SignupUnavailable("Requesting access is not available on this portal.")
        return self._repo

    def _throttle(self, client: str) -> None:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._seen.get(client, []) if now - t < 3600]
            if len(recent) >= PER_HOUR:
                raise TooManyRequests("Too many requests from this computer. Please try again later.")
            self._seen[client] = [*recent, now]

    # ---------------------------------------------------------------- the person asking
    def submit(self, full_name: str, email: str, client: str, phone: str = "", country: str = "") -> None:
        """Record a request. Asking twice with the same e-mail while one is waiting does nothing more (and says nothing different)."""
        store = self._store()
        name, address = " ".join(full_name.split()), email.strip().lower()
        phone, country = " ".join(phone.split()), " ".join(country.split())
        if len(name) < 2:
            raise ValidationFailedError("Please enter your name.")
        if len(re.sub(r"\D", "", phone)) < 6 or not _PHONE.match(phone):
            raise ValidationFailedError("Please enter a valid phone number.")
        if not _EMAIL.match(address) or len(address) > 200:
            raise ValidationFailedError("Please enter a valid business e-mail address.")
        if not country or len(country) > 100:
            raise ValidationFailedError("Please select your country.")
        self._throttle(client)
        try:
            if store.pending_for(address) is not None:
                return
            if sum(1 for r in store.list_all() if r["status"] == "pending") >= MAX_PENDING:
                raise SignupUnavailable("Too many requests are waiting. Please try again later.")
            store.add(address, name, phone, country)
        except AppError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Access request from %s was not saved: %s", address, exc)
            raise SignupUnavailable("Your request could not be saved. Please try again later.") from exc

    # ---------------------------------------------------------------- the admin
    def list_requests(self) -> list[dict]:
        return [request_view(r) for r in self._store().list_all()]

    def approve(self, request_id: int, admin: str, role: str, access_type: str, access_days: int | None, expires_at: datetime | None) -> dict:
        store = self._store()
        row = self._pending(request_id)
        if not self._mailer.is_configured():
            raise IntegrationError("SMTP", "not configured, so the login details cannot be e-mailed (set the SMTP settings in .env)")

        username = row["email"]  # the full e-mail address is the user name
        if self._users.get(username) is not None:
            raise ConflictError(f"{username} already has an account.")
        password = secrets.token_urlsafe(9)
        self._admin.create(username, row["full_name"], password, role, access_type=access_type, access_days=access_days, expires_at=expires_at, must_change_password=True)
        try:
            self._mailer.send(row["email"], "Your HR AI Agents portal access", self._approved_mail(row["full_name"], username, password))
        except Exception:
            self._users.delete(username)  # nobody has the password, so do not leave the user behind
            raise
        store.decide(request_id, "approved", admin, username)
        return request_view(store.get(request_id))

    def reject(self, request_id: int, admin: str) -> dict:
        store = self._store()
        row = self._pending(request_id)
        store.decide(request_id, "rejected", admin, None)
        emailed = True
        try:
            self._mailer.send(row["email"], "Your HR AI Agents portal request", self._rejected_mail(row["full_name"]))
        except Exception as exc:  # noqa: BLE001 - the decision stands even if the note could not be sent
            logger.warning("Rejection note to %s was not sent: %s", row["email"], exc)
            emailed = False
        return {**request_view(store.get(request_id)), "emailed": emailed}

    def _pending(self, request_id: int) -> dict:
        row = self._store().get(request_id)
        if row is None:
            raise NotFoundError("That request was not found.")
        if row["status"] != "pending":
            raise ConflictError(f"That request was already {row['status']}.")
        return row

    # ---------------------------------------------------------------- the e-mails
    @staticmethod
    def _approved_mail(full_name: str, username: str, password: str) -> str:
        return (
            f"<p>Hello {html.escape(full_name)},</p>"
            "<p>Your request for the HR AI Agents portal was approved. Sign in with:</p>"
            f"<p>User name: <b>{html.escape(username)}</b><br>Password: <b>{html.escape(password)}</b></p>"
            "<p>For your security you will be asked to choose your own password the first time you sign in.</p>"
            "<p>Regards,<br>AutomationEdge</p>"
        )

    @staticmethod
    def _rejected_mail(full_name: str) -> str:
        return (
            f"<p>Hello {html.escape(full_name)},</p>"
            "<p>Your request for access to the HR AI Agents portal was not approved this time.</p>"
            "<p>Regards,<br>AutomationEdge</p>"
        )

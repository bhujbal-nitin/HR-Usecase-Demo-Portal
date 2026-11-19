"""Login for the portal: checks a user name and password against the user table and issues / reads the session cookie."""

import logging
import secrets
import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from app.core import passwords, sessions
from app.core.config import Settings
from app.core.exceptions import AppError, ValidationFailedError
from app.repositories.user_repository import PortalUser, UserRepository

logger = logging.getLogger(__name__)

MAX_FAILURES = 5
MIN_PASSWORD_LENGTH = 8
FAILURE_WINDOW_SECONDS = 10 * 60


class InvalidLogin(AppError):
    status_code = 401


class TooManyAttempts(AppError):
    status_code = 429


class LoginUnavailable(AppError):
    status_code = 503


class NotAllowed(AppError):
    status_code = 403


class AuthService:
    def __init__(self, settings: Settings, users: UserRepository):
        self._enabled = settings.auth_enabled
        self._users = users
        self._lifetime = settings.auth_session_hours * 3600
        self._secret = settings.auth_secret_key.get_secret_value()
        self._failures: dict[tuple[str, str], list[float]] = {}
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def lifetime_seconds(self) -> int:
        return self._lifetime

    def start(self) -> None:
        """Prepare the user table. A database that is down must not stop the portal from starting: login then answers 'unavailable'."""
        if not self._enabled:
            return
        if not self._secret:
            self._secret = secrets.token_urlsafe(48)
            logger.warning("AUTH_SECRET_KEY is not set: sessions are signed with a random key and end whenever the backend restarts.")
        try:
            self._users.ensure_schema()
        except Exception as exc:  # noqa: BLE001 - any driver / connection problem
            logger.error("Login database is not ready: %s", exc)

    # ---------------------------------------------------------------- login
    def login(self, username: str, password: str, client: str) -> tuple[PortalUser, str]:
        """The signed-in user and the cookie value; raises when the details are wrong or the user table cannot be read."""
        name = username.strip()
        key = (client, name.lower())
        self._check_not_locked(key)
        try:
            user = self._users.get(name) if name else None
        except Exception as exc:  # noqa: BLE001 - database down, table missing, bad credentials for the database...
            logger.error("Login lookup failed: %s", exc)
            raise LoginUnavailable("Login is not available right now. Please try again shortly.") from exc
        valid = passwords.verify_password(password, user.password_hash if user else passwords.DUMMY_HASH)
        if not (user and user.is_active and valid):
            self._record_failure(key)
            raise InvalidLogin("Incorrect user name or password.")
        if user.is_expired:
            raise InvalidLogin("Your access has expired. Please contact an administrator.")

        # On the user's first login, start the access timer if based on days
        if user.first_login_at is None:
            now = datetime.now(timezone.utc)
            user.first_login_at = now
            if user.access_type == "days" and user.access_days:
                user.expires_at = now + timedelta(days=user.access_days)
            try:
                self._users.save(user)
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to record first login timestamp for %s: %s", user.username, exc)

        with self._lock:
            self._failures.pop(key, None)
        return user, sessions.issue(self._secret, user.username, self._lifetime)

    def change_password(self, token: str | None, current: str, new: str, client: str) -> None:
        """A signed-in user changes their own password: the current one must be right (wrong guesses count towards the lock, like at login)."""
        username = self.user_for(token)
        if not self._enabled or not username:
            raise InvalidLogin("Please sign in first.")
        key = (client, username.lower())
        self._check_not_locked(key)
        try:
            user = self._users.get(username)
        except Exception as exc:  # noqa: BLE001
            logger.error("Password change lookup failed: %s", exc)
            raise LoginUnavailable("The password cannot be changed right now. Please try again shortly.") from exc
        if user is None or not user.is_active or user.is_expired:
            raise InvalidLogin("Please sign in first.")
        if not passwords.verify_password(current, user.password_hash):
            self._record_failure(key)
            raise ValidationFailedError("The current password is not correct.")
        if len(new) < MIN_PASSWORD_LENGTH:
            raise ValidationFailedError(f"The new password must be at least {MIN_PASSWORD_LENGTH} characters.")
        if new == current:
            raise ValidationFailedError("The new password must be different from the current one.")
        self._users.save(replace(user, password_hash=passwords.hash_password(new), must_change_password=False))
        with self._lock:
            self._failures.pop(key, None)

    def _recent(self, key: tuple[str, str]) -> list[float]:
        cutoff = time.time() - FAILURE_WINDOW_SECONDS
        return [t for t in self._failures.get(key, []) if t > cutoff]

    def _check_not_locked(self, key: tuple[str, str]) -> None:
        with self._lock:
            if len(self._recent(key)) >= MAX_FAILURES:
                raise TooManyAttempts("Too many failed attempts. Please wait a few minutes and try again.")

    def _record_failure(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._failures[key] = [*self._recent(key), time.time()]

    # -------------------------------------------------------------- session
    def user_for(self, token: str | None) -> str | None:
        """The user name behind a session cookie, or None when there is none or it is not valid."""
        return sessions.read(self._secret, token)

    def require_admin(self, token: str | None) -> PortalUser:
        """The signed-in admin behind the cookie; raises NotAllowed for anybody else (or when login is off, as there are then no users)."""
        if not self._enabled:
            raise NotAllowed("Turn login on (AUTH_ENABLED=true) to use the admin page.")
        username = self.user_for(token)
        try:
            user = self._users.get(username) if username else None
        except Exception as exc:  # noqa: BLE001
            raise LoginUnavailable("The user list is not available right now. Please try again shortly.") from exc
        if user is None or not user.is_active or user.is_expired or not user.is_admin:
            raise NotAllowed("Only an admin can do this.")
        return user

    def describe(self, token: str | None) -> dict:
        """What the page needs to know: is login on, and who is signed in."""
        if not self._enabled:
            return {"authEnabled": False, "authenticated": True, "username": None, "fullName": None, "role": None}
        username = self.user_for(token)
        full_name, role, must_change = None, None, False
        if username:
            try:
                user = self._users.get(username)
            except Exception:  # noqa: BLE001 - a database blip should not sign everybody out
                user = None
            if user is not None and (not user.is_active or user.is_expired):
                username = None
            else:
                full_name = (user.full_name if user else "") or None
                role = user.role if user else None
                must_change = bool(user and user.must_change_password)
        return {"authEnabled": True, "authenticated": bool(username), "username": username, "fullName": full_name, "role": role, "mustChangePassword": must_change}

"""Web-session login like HRMS's: a login page with a CSRF token, a form post that sets the ``orangehrm`` cookie.

Tokens and the session cookie are signed (HMAC), so they survive a restart and need no server-side session table.
"""

import hashlib
import hmac
import secrets
import time

from app.core.config import Settings

COOKIE = "orangehrm"
_CSRF_SECONDS = 3600


class HrmsAuth:
    def __init__(self, settings: Settings):
        self._s = settings
        password = settings.hrms_admin_password.get_secret_value()
        self._key = hashlib.sha256(f"hrms|{settings.hrms_admin_username}|{password}|{settings.auth_secret_key.get_secret_value()}".encode()).digest()

    def _sign(self, payload: str) -> str:
        return hmac.new(self._key, payload.encode(), hashlib.sha256).hexdigest()[:32]

    def _issue(self, kind: str, subject: str, seconds: int) -> str:
        payload = f"{kind}|{subject}|{int(time.time()) + seconds}"
        return f"{payload}|{self._sign(payload)}"

    def _check(self, kind: str, token: str | None) -> str | None:
        """The subject of a valid, unexpired token of this kind; None otherwise."""
        parts = (token or "").split("|")
        if len(parts) != 4 or parts[0] != kind:
            return None
        payload = "|".join(parts[:3])
        if not hmac.compare_digest(parts[3], self._sign(payload)) or not parts[2].isdigit() or int(parts[2]) < time.time():
            return None
        return parts[1]

    # --------------------------------------------------------- login form
    def csrf_token(self) -> str:
        return self._issue("csrf", secrets.token_hex(8), _CSRF_SECONDS)

    def csrf_valid(self, token: str | None) -> bool:
        return self._check("csrf", token) is not None

    def credentials_valid(self, username: str, password: str) -> bool:
        good_user = hmac.compare_digest(username.strip().lower().encode(), self._s.hrms_admin_username.lower().encode())
        good_pass = hmac.compare_digest(password.encode(), self._s.hrms_admin_password.get_secret_value().encode())
        return good_user and good_pass

    # ------------------------------------------------------------ session
    def session_cookie(self) -> str:
        return self._issue("session", self._s.hrms_admin_username, self._s.hrms_session_hours * 3600)

    def username(self, cookie: str | None) -> str | None:
        return self._check("session", cookie)

    @property
    def max_age(self) -> int:
        return self._s.hrms_session_hours * 3600

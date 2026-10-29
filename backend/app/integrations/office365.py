"""Microsoft 365 / Entra ID client (Microsoft Graph v1.0)."""

import logging
import re
import time

import requests

from app.core.config import Settings
from app.core.exceptions import IntegrationError, IntegrationNotConfiguredError
from app.integrations.http import DEFAULT_TIMEOUT, build_session, error_text
from app.schemas.employee import Employee, Office365Info
from app.utils.formatting import generate_temporary_password

logger = logging.getLogger(__name__)
SYSTEM = "Microsoft 365"
GRAPH_URL = "https://graph.microsoft.com/v1.0"
ADMIN_URL = "https://portal.azure.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/{}"


class Office365Client:
    def __init__(self, settings: Settings):
        self._s = settings
        self._session = build_session(settings.verify_ssl)
        self._token: str | None = None
        self._token_expiry = 0.0

    def is_configured(self) -> bool:
        return bool(
            self._s.o365_tenant_id
            and self._s.o365_client_id
            and self._s.o365_client_secret.get_secret_value()
            and self._s.o365_default_domain
        )

    def _require(self) -> None:
        if not self.is_configured():
            raise IntegrationNotConfiguredError(SYSTEM)

    # ------------------------------------------------------------------- auth
    def get_access_token(self) -> str:
        self._require()
        now = time.time()
        if self._token and now < self._token_expiry - 60:
            return self._token

        token_url = f"https://login.microsoftonline.com/{self._s.o365_tenant_id}/oauth2/v2.0/token"
        base = {"client_id": self._s.o365_client_id, "client_secret": self._s.o365_client_secret.get_secret_value()}
        grants = [{**base, "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}]
        refresh = self._s.o365_refresh_token.get_secret_value()
        if refresh:
            grants.append({**base, "refresh_token": refresh, "grant_type": "refresh_token"})

        last_error = "no grant succeeded"
        for form in grants:
            try:
                response = self._session.post(token_url, data=form, timeout=15)
            except requests.RequestException as exc:
                last_error = str(exc)
                continue
            if response.status_code == 200:
                data = response.json()
                self._token = data["access_token"]
                self._token_expiry = now + int(data.get("expires_in", 3600))
                return self._token
            last_error = error_text(response)
        raise IntegrationError(SYSTEM, f"token request failed ({last_error})")

    def check_connection(self) -> str:
        self.get_access_token()
        return "Token acquired"

    # ------------------------------------------------------------------ users
    def build_identity(self, emp: Employee) -> tuple[str, str, str]:
        """Return (given_name, mail_nickname, user_principal_name)."""
        first = re.sub(r"[^a-z0-9]", "", emp.first_name.lower())
        last = re.sub(r"[^a-z0-9]", "", emp.last_name.lower()) if emp.last_name != emp.first_name else ""
        nickname = f"{first}.{last}" if last else first
        return emp.first_name, nickname, f"{nickname}@{self._s.o365_default_domain}"

    def create_user(self, emp: Employee) -> Office365Info:
        token = self.get_access_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        given_name, nickname, upn = self.build_identity(emp)

        existing = self._session.get(f"{GRAPH_URL}/users/{upn}", headers=headers, timeout=DEFAULT_TIMEOUT)
        if existing.status_code == 200:
            data = existing.json()
            return Office365Info(
                user_id=data.get("id"),
                user_principal_name=upn,
                display_name=data.get("displayName", emp.full_name),
                initial_password=None,  # the account pre-dates this run; its password is not ours to report
                admin_url=ADMIN_URL.format(data.get("id")),
                already_existed=True,
            )

        password = generate_temporary_password()
        body = {
            "accountEnabled": True,
            "displayName": emp.full_name,
            "givenName": given_name,
            "surname": emp.last_name if emp.last_name != emp.first_name else None,
            "mailNickname": nickname,
            "userPrincipalName": upn,
            "department": emp.department,
            "jobTitle": emp.job_title,
            "mobilePhone": emp.phone or None,
            "passwordProfile": {"forceChangePasswordNextSignIn": True, "password": password},
        }
        response = self._post_user(headers, body)

        # Name clash with a different account: retry once with the employee id appended.
        if response.status_code == 409 or (
            response.status_code == 400 and "already exists" in response.text.lower()
        ):
            suffix = re.sub(r"[^a-z0-9]", "", emp.id.lower())
            nickname = f"{nickname}.{suffix}"
            upn = f"{nickname}@{self._s.o365_default_domain}"
            body.update({"mailNickname": nickname, "userPrincipalName": upn})
            response = self._post_user(headers, body)

        if response.status_code not in (200, 201):
            raise IntegrationError(SYSTEM, f"user creation failed - {error_text(response)}")
        created = response.json()
        return Office365Info(
            user_id=created.get("id"),
            user_principal_name=created.get("userPrincipalName", upn),
            display_name=created.get("displayName", emp.full_name),
            initial_password=password,
            admin_url=ADMIN_URL.format(created.get("id")),
        )

    def offboard_user(self, user_ref: str) -> dict:
        """Block sign-in, revoke every session and remove all licences. The account is kept, not deleted.

        Safe to repeat: an account that is already blocked and unlicensed simply reports that. ``user_ref`` is the
        user principal name or the object id.
        """
        token = self.get_access_token()
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        url = f"{GRAPH_URL}/users/{user_ref}"
        try:
            found = self._session.get(
                f"{url}?$select=id,displayName,accountEnabled,assignedLicenses", headers=headers, timeout=DEFAULT_TIMEOUT
            )
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"lookup of {user_ref} failed: {exc}") from exc
        if found.status_code == 404:
            raise IntegrationError(SYSTEM, f"no Microsoft 365 account named {user_ref} was found")
        if not found.ok:
            raise IntegrationError(SYSTEM, f"lookup of {user_ref} -> {error_text(found)}")
        user = found.json()
        user_id = user["id"]
        skus = [lic["skuId"] for lic in user.get("assignedLicenses", []) if lic.get("skuId")]

        def call(method: str, path: str, **kwargs) -> requests.Response:
            try:
                response = self._session.request(method, f"{GRAPH_URL}/users/{user_id}{path}", headers=headers, timeout=30, **kwargs)
            except requests.RequestException as exc:
                raise IntegrationError(SYSTEM, f"{method} {path or '/'} failed: {exc}") from exc
            if not response.ok:
                raise IntegrationError(SYSTEM, f"{method} {path or '/'} -> {error_text(response)}")
            return response

        call("PATCH", "", json={"accountEnabled": False})
        call("POST", "/revokeSignInSessions")
        if skus:
            call("POST", "/assignLicense", json={"addLicenses": [], "removeLicenses": skus})
        return {
            "userId": user_id,
            "displayName": user.get("displayName"),
            "signInBlocked": True,
            "sessionsRevoked": True,
            "licencesRemoved": len(skus),
            "adminUrl": ADMIN_URL.format(user_id),
        }

    def _post_user(self, headers: dict, body: dict) -> requests.Response:
        try:
            return self._session.post(f"{GRAPH_URL}/users", headers=headers, json=body, timeout=30)
        except requests.RequestException as exc:
            raise IntegrationError(SYSTEM, f"user creation request failed: {exc}") from exc

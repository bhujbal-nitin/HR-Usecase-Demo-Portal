"""Login for the portal: the session cookie, the guard on /api and the user table (replaced by a fake)."""

import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient

from app.core import passwords, sessions
from app.core.config import Settings
from app.main import create_app
from app.repositories.user_repository import PortalUser
from app.services import auth_service
from app.services.auth_service import AuthService


class FakeUsers:
    def __init__(self, *users, down=False):
        self.users, self.down, self.schema_calls = {u.username.lower(): u for u in users}, down, 0

    def ensure_schema(self):
        self.schema_calls += 1
        if self.down:
            raise RuntimeError("database is down")

    def get(self, username):
        if self.down:
            raise RuntimeError("database is down")
        return self.users.get(username.lower())

    def save(self, user):
        self.users[user.username.lower()] = user


def alice(**kw):
    return PortalUser("alice", passwords.hash_password("correct-horse"), "Alice Rao", **kw)


@pytest.fixture
def secured(settings: Settings):
    """A client for an app with login switched on and one user, 'alice'."""
    settings = settings.model_copy(update={"auth_enabled": True, "auth_secret_key": SecretStr("test-secret")})
    users = FakeUsers(alice(), PortalUser("bob", passwords.hash_password("battery-staple"), "", False))
    app = create_app(settings)
    with TestClient(app) as c:
        c.app.state.container.auth = AuthService(settings, users)
        c.app.state.container.auth.start()
        c.users = users
        yield c


def sign_in(c, username="alice", password="correct-horse"):
    return c.post("/api/auth/login", json={"username": username, "password": password})


# ------------------------------------------------------------------------------------------ the building blocks
def test_a_password_hash_matches_only_its_own_password():
    stored = passwords.hash_password("s3cret-pass")
    assert stored.startswith("pbkdf2_sha256$") and "s3cret-pass" not in stored
    assert passwords.verify_password("s3cret-pass", stored)
    assert not passwords.verify_password("other", stored)
    assert not passwords.verify_password("s3cret-pass", "not-a-hash")
    assert passwords.hash_password("s3cret-pass") != stored  # each hash has its own salt


def test_a_session_token_is_checked_for_signature_and_expiry():
    token = sessions.issue("key", "alice", 60, now=1000)
    assert sessions.read("key", token, now=1030) == "alice"
    assert sessions.read("key", token, now=1061) is None  # expired
    assert sessions.read("other-key", token, now=1030) is None  # signed with another key
    assert sessions.read("key", token[:-2] + "xx", now=1030) is None  # tampered
    assert sessions.read("key", None) is None and sessions.read("key", "garbage") is None


# ------------------------------------------------------------------------------------------------ the API
def test_every_api_call_needs_a_session_but_health_and_login_do_not(secured):
    assert secured.get("/api/employees").status_code == 401
    assert secured.get("/api/leave/options").status_code == 401
    assert secured.get("/api/health").status_code == 200
    me = secured.get("/api/auth/me").json()
    assert me["authEnabled"] is True and me["authenticated"] is False


def test_signing_in_opens_the_api_and_signing_out_closes_it(secured):
    answer = sign_in(secured)
    assert answer.status_code == 200 and answer.json()["fullName"] == "Alice Rao"
    assert "httponly" in answer.headers["set-cookie"].lower()
    assert secured.get("/api/employees").status_code == 200
    assert secured.get("/api/auth/me").json()["username"] == "alice"

    assert secured.post("/api/auth/logout").status_code == 200
    assert secured.get("/api/employees").status_code == 401


def test_wrong_details_and_disabled_users_are_refused_with_one_message(secured):
    messages = {sign_in(secured, "alice", "wrong").json()["detail"], sign_in(secured, "nobody", "x").json()["detail"], sign_in(secured, "bob", "battery-staple").json()["detail"]}
    assert messages == {"Incorrect user name or password."}
    assert sign_in(secured, "alice", "wrong").status_code == 401
    assert secured.get("/api/employees").status_code == 401


def test_the_user_name_is_not_case_sensitive(secured):
    assert sign_in(secured, "  ALICE ").status_code == 200


def test_repeated_failures_lock_the_attempts_for_a_while(secured):
    for _ in range(auth_service.MAX_FAILURES):
        assert sign_in(secured, "alice", "wrong").status_code == 401
    assert sign_in(secured, "alice", "correct-horse").status_code == 429


def test_a_forged_cookie_is_not_a_session(secured):
    secured.cookies.set("hr_session", sessions.issue("some-other-key", "alice", 3600))
    assert secured.get("/api/employees").status_code == 401


def test_a_user_disabled_after_signing_in_is_signed_out(secured):
    sign_in(secured)
    secured.users.users["alice"].is_active = False
    assert secured.get("/api/auth/me").json()["authenticated"] is False


def test_login_says_unavailable_when_the_database_is_down(secured):
    secured.users.down = True
    answer = sign_in(secured)
    assert answer.status_code == 503 and "not available" in answer.json()["detail"]


def test_the_portal_starts_even_if_the_database_is_down(settings):
    users = FakeUsers(down=True)
    service = AuthService(settings.model_copy(update={"auth_enabled": True}), users)
    service.start()  # must not raise
    assert users.schema_calls == 1


def test_with_login_off_nothing_changes(client):
    assert client.get("/api/employees").status_code == 200
    me = client.get("/api/auth/me").json()
    assert me["authEnabled"] is False and me["authenticated"] is True

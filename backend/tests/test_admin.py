"""Roles, the admin API (users and token usage) and the Gemini reader's token tracking. No real database or Google call is made."""

import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core import passwords
from app.core.config import Settings
from app.core.request_context import NO_LOGIN, current_user, feature
from app.integrations.gemini_documents import GeminiDocumentReader
from app.main import create_app
from app.repositories.usage_repository import UsageCall
from app.repositories.user_repository import PortalUser
from app.core.exceptions import IntegrationError
from app.services.access_request_service import AccessRequestService
from app.services.auth_service import AuthService
from app.services.demo_run_service import DemoRunService
from app.services.usage_service import UsageService
from app.services.user_admin_service import UserAdminService


class FakeUsers:
    def __init__(self, *users):
        self.users = {u.username.lower(): u for u in users}

    def ensure_schema(self):
        pass

    def get(self, username):
        return self.users.get(username.lower())

    def save(self, user):
        user.created_at = user.created_at or datetime.now(UTC)
        self.users[user.username.lower()] = user

    def list_all(self):
        return list(self.users.values())

    def delete(self, username):
        self.users.pop(username.lower(), None)


class FakeUsage:
    def __init__(self):
        self.calls: list[UsageCall] = []

    def ensure_schema(self):
        pass

    def record(self, call):
        self.calls.append(call)

    def totals(self, days=None):
        rows: dict[str, dict] = {}
        for i, c in enumerate(self.calls):
            r = rows.setdefault(c.username.lower(), {"username": c.username, "calls": 0, "input_tokens": 0, "output_tokens": 0,
                                                    "total_tokens": 0, "last_used": datetime(2026, 11, 13, 10, i, tzinfo=UTC)})
            r["calls"] += 1
            r["input_tokens"] += c.input_tokens
            r["output_tokens"] += c.output_tokens
            r["total_tokens"] += c.total_tokens
        return list(rows.values())

    def history(self, username, limit, offset):
        mine = [c for c in self.calls if not username or c.username.lower() == username.lower()]
        rows = [
            {"id": i, "username": c.username, "feature": c.feature, "model": c.model, "input_tokens": c.input_tokens,
             "output_tokens": c.output_tokens, "total_tokens": c.total_tokens, "created_at": datetime(2026, 11, 13, 10, i, tzinfo=UTC)}
            for i, c in enumerate(mine)
        ]
        return rows[offset:offset + limit], len(rows)


class FakeRuns:
    def __init__(self):
        self.rows: list[dict] = []

    def ensure_schema(self):
        pass

    def start(self, username, agent, mode, manual):
        self.rows.append({"id": len(self.rows) + 1, "username": username, "agent": agent, "mode": mode, "manual": manual,
                          "started_at": datetime(2026, 11, 17, 10, len(self.rows), tzinfo=UTC), "ended_at": None, "outcome": None, "detail": None})
        return len(self.rows)

    def finish(self, run_id, username, outcome, detail):
        row = next((r for r in self.rows if r["id"] == run_id and r["username"].lower() == username.lower() and r["ended_at"] is None), None)
        if row is None:
            return False
        row.update(ended_at=row["started_at"].replace(minute=row["started_at"].minute + 3), outcome=outcome, detail=detail or None)
        return True

    def history(self, username, agent, limit, offset):
        mine = [r for r in reversed(self.rows) if (not username or r["username"].lower() == username.lower()) and (not agent or r["agent"] == agent)]
        return mine[offset:offset + limit], len(mine)


class FakeRequests:
    def __init__(self):
        self.rows: list[dict] = []

    def ensure_schema(self):
        pass

    def add(self, email, full_name):
        row = {"id": len(self.rows) + 1, "email": email, "full_name": full_name, "status": "pending",
               "requested_at": datetime(2026, 11, 19, 9, 0, tzinfo=UTC), "decided_at": None, "decided_by": None, "username": None}
        self.rows.append(row)
        return row

    def get(self, request_id):
        return next((r for r in self.rows if r["id"] == request_id), None)

    def pending_for(self, email):
        return next((r for r in self.rows if r["email"].lower() == email.lower() and r["status"] == "pending"), None)

    def list_all(self):
        return list(reversed(self.rows))

    def decide(self, request_id, status, decided_by, username):
        row = self.get(request_id)
        if row is None or row["status"] != "pending":
            return False
        row.update(status=status, decided_by=decided_by, username=username, decided_at=datetime(2026, 11, 19, 10, 0, tzinfo=UTC))
        return True


class FakeMailer:
    def __init__(self, configured=True):
        self.configured, self.sent = configured, []

    def is_configured(self):
        return self.configured

    def send(self, to, subject, html_body, attachment=None):
        if not self.configured:
            raise IntegrationError("SMTP", "not configured")
        self.sent.append((to, subject, html_body))


def person(name, role="user", active=True):
    return PortalUser(name, passwords.hash_password("pass-" + name * 3), name.title(), active, role, datetime(2026, 1, 1, tzinfo=UTC))


@pytest.fixture
def portal(settings: Settings):
    settings = settings.model_copy(update={"auth_enabled": True, "auth_secret_key": SecretStr("test-secret")})
    users = FakeUsers(person("alice", "admin"), person("bob"))
    usage = FakeUsage()
    with TestClient(create_app(settings)) as c:
        container = c.app.state.container
        container.auth = AuthService(settings, users)
        container.usage = UsageService(usage)
        container.user_admin = UserAdminService(users, container.usage)
        c.runs = FakeRuns()
        container.demo_runs = DemoRunService(c.runs)
        c.requests, c.mail = FakeRequests(), FakeMailer()
        container.access_requests = AccessRequestService(settings, c.requests, users, container.user_admin, c.mail)
        c.users, c.usage = users, usage
        yield c


def sign_in(c, name):
    assert c.post("/api/auth/login", json={"username": name, "password": "pass-" + name * 3}).status_code == 200


# ------------------------------------------------------------------------------------------------ roles
def test_me_tells_the_page_the_role(portal):
    sign_in(portal, "bob")
    assert portal.get("/api/auth/me").json()["role"] == "user"
    sign_in(portal, "alice")
    assert portal.get("/api/auth/me").json()["role"] == "admin"


def test_a_normal_user_is_refused_every_admin_call(portal):
    sign_in(portal, "bob")
    for method, url in [("get", "/api/admin/users"), ("get", "/api/admin/usage"), ("get", "/api/admin/usage/history")]:
        assert getattr(portal, method)(url).status_code == 403
    assert portal.post("/api/admin/users", json={"username": "carol", "password": "longenough"}).status_code == 403
    assert portal.patch("/api/admin/users/bob", json={"role": "admin"}).status_code == 403  # no promoting yourself
    assert portal.users.get("bob").role == "user"


def test_nobody_signed_in_gets_401_and_login_off_gets_403(portal, settings):
    assert portal.get("/api/admin/users").status_code == 401
    with TestClient(create_app(settings)) as open_portal:  # login switched off
        assert open_portal.get("/api/admin/users").status_code == 403


def test_a_disabled_admin_is_refused(portal):
    sign_in(portal, "alice")
    portal.users.get("alice").is_active = False
    assert portal.get("/api/admin/users").status_code in (401, 403)


# ------------------------------------------------------------------------------------------------ managing users
def test_an_admin_adds_a_user_who_can_then_sign_in(portal):
    sign_in(portal, "alice")
    created = portal.post("/api/admin/users", json={"username": " carol ", "fullName": "Carol N", "password": "a-long-password", "role": "user"})
    assert created.status_code == 201 and created.json()["username"] == "carol" and created.json()["role"] == "user"
    assert "passwordHash" not in created.json() and "password" not in json.dumps(created.json()).lower().replace("passwords", "")
    assert portal.users.get("carol").password_hash.startswith("pbkdf2_sha256$")  # stored hashed
    portal.post("/api/auth/logout")
    assert portal.post("/api/auth/login", json={"username": "carol", "password": "a-long-password"}).status_code == 200


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"username": "bob", "password": "a-long-password"}, 409),  # taken (any capitalisation)
        ({"username": "BOB", "password": "a-long-password"}, 409),
        ({"username": "carol", "password": "short"}, 422),
        ({"username": "ca", "password": "a-long-password"}, 422),
        ({"username": "car ol", "password": "a-long-password"}, 422),
        ({"username": "carol", "password": "a-long-password", "role": "boss"}, 422),
    ],
)
def test_bad_new_users_are_refused(portal, body, status):
    sign_in(portal, "alice")
    assert portal.post("/api/admin/users", json=body).status_code == status


def test_an_admin_can_disable_promote_and_reset_a_password(portal):
    sign_in(portal, "alice")
    assert portal.patch("/api/admin/users/bob", json={"role": "admin", "fullName": "Bob B"}).json()["role"] == "admin"
    assert portal.patch("/api/admin/users/bob", json={"isActive": False}).json()["isActive"] is False
    portal.post("/api/auth/logout")
    assert portal.post("/api/auth/login", json={"username": "bob", "password": "pass-bobbobbob"}).status_code == 401  # disabled
    sign_in(portal, "alice")
    portal.patch("/api/admin/users/bob", json={"isActive": True, "password": "brand-new-pass"})
    portal.post("/api/auth/logout")
    assert portal.post("/api/auth/login", json={"username": "bob", "password": "brand-new-pass"}).status_code == 200
    assert portal.patch("/api/admin/users/nobody", json={"role": "user"}).status_code == 404


def test_the_last_active_admin_cannot_be_removed(portal):
    sign_in(portal, "alice")
    assert portal.patch("/api/admin/users/alice", json={"role": "user"}).status_code == 409
    assert portal.patch("/api/admin/users/alice", json={"isActive": False}).status_code == 409
    assert portal.users.get("alice").role == "admin" and portal.users.get("alice").is_active
    portal.patch("/api/admin/users/bob", json={"role": "admin"})  # with a second admin it is allowed
    assert portal.patch("/api/admin/users/alice", json={"role": "user"}).status_code == 200


# ------------------------------------------------------------------------------------------------ token tracking
def test_usage_is_recorded_against_the_user_and_feature():
    usage = FakeUsage()
    service = UsageService(usage)
    service.record("gemini-x", 100, 20)  # no signed-in user
    token = current_user.set("alice")
    try:
        with feature("Reimbursement bill"):
            service.record("gemini-x", 300, 40, 380)
    finally:
        current_user.reset(token)
    first, second = usage.calls
    assert (first.username, first.feature, first.total_tokens) == (NO_LOGIN, "Other", 120)
    assert (second.username, second.feature, second.total_tokens) == ("alice", "Reimbursement bill", 380)


def test_a_failing_usage_store_never_breaks_the_ai_call():
    class Broken(FakeUsage):
        def record(self, call):
            raise RuntimeError("db down")

    UsageService(Broken()).record("m", 1, 1)  # must not raise


def test_the_admin_sees_totals_for_every_user_and_the_history(portal):
    portal.usage.record(UsageCall("bob", "Onboarding document check", "m", 100, 10, 110))
    portal.usage.record(UsageCall("BOB", "Reimbursement bill", "m", 200, 20, 220))
    portal.usage.record(UsageCall(NO_LOGIN, "Other", "m", 5, 5, 10))
    sign_in(portal, "alice")
    rows = {r["username"]: r for r in portal.get("/api/admin/usage").json()}
    assert rows["bob"]["calls"] == 2 and rows["bob"]["totalTokens"] == 330 and rows["bob"]["inputTokens"] == 300
    assert rows["alice"]["calls"] == 0 and rows["alice"]["totalTokens"] == 0  # users who have not used the AI yet are listed too
    assert rows[NO_LOGIN]["totalTokens"] == 10
    assert list(rows)[0] == "bob"  # biggest user first
    history = portal.get("/api/admin/usage/history", params={"username": "bob"}).json()
    assert history["total"] == 2 and {i["feature"] for i in history["items"]} == {"Onboarding document check", "Reimbursement bill"}
    assert portal.get("/api/admin/usage/history", params={"limit": 1}).json()["items"].__len__() == 1


# ------------------------------------------------------------------------------------------------ the Gemini reader
class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def make_reader(tmp_path, usage):
    key = tmp_path / "service-account.json"
    key.write_text("{}", encoding="utf-8")
    settings = Settings(_env_file=None, google_credentials_file=key, google_project_id="demo-project", google_location="us-central1")
    reader = GeminiDocumentReader(settings, UsageService(usage))
    reader._token_and_project = lambda: ("tok", "demo-project")  # no real Google sign-in
    return reader


def test_the_reader_sends_the_file_and_records_the_tokens(tmp_path):
    usage = FakeUsage()
    reader = make_reader(tmp_path, usage)
    sent = {}

    def post(url, json, headers, timeout):
        sent.update(url=url, body=json, headers=headers)
        return FakeResponse({
            "candidates": [{"content": {"parts": [{"text": '{"documentType": "pan"}'}]}}],
            "usageMetadata": {"promptTokenCount": 1200, "candidatesTokenCount": 30, "thoughtsTokenCount": 70, "totalTokenCount": 1300},
        })

    reader._session.post = post
    token = current_user.set("bob")
    try:
        with feature("Onboarding document check"):
            answer = reader.read("pan.pdf", b"%PDF-1.4 x", "application/pdf")
    finally:
        current_user.reset(token)

    assert answer == {"documentType": "pan"}
    assert sent["url"].startswith("https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/")
    assert sent["url"].endswith("/models/gemini-2.5-flash:generateContent") and sent["headers"]["Authorization"] == "Bearer tok"
    part = sent["body"]["contents"][0]["parts"][1]["inlineData"]
    assert part["mimeType"] == "application/pdf"
    (call,) = usage.calls
    assert (call.username, call.feature, call.input_tokens, call.output_tokens, call.total_tokens) == ("bob", "Onboarding document check", 1200, 100, 1300)


def test_the_reader_is_off_without_the_key_file_and_reports_google_errors(tmp_path):
    from app.core.exceptions import IntegrationError

    settings = Settings(_env_file=None, google_credentials_file=tmp_path / "missing.json")
    off = GeminiDocumentReader(settings)
    assert not off.is_configured()
    with pytest.raises(IntegrationError):
        off.read("a.pdf", b"x", "application/pdf")

    usage = FakeUsage()
    reader = make_reader(tmp_path, usage)
    reader._session.post = lambda *a, **k: type("R", (), {"status_code": 403, "text": "", "json": lambda self: {}})()
    with pytest.raises(IntegrationError, match="refused by Google"):
        reader.read("a.pdf", b"x", "application/pdf")
    assert usage.calls == []  # a refused call used no tokens


# ------------------------------------------------------------------------------------------------ demo history
def test_a_demo_run_is_recorded_for_the_user_who_started_it_and_closed_once(portal):
    sign_in(portal, "bob")
    run = portal.post("/api/demo-runs", json={"agent": "pre_onboarding", "mode": "live", "manual": True}).json()["id"]
    assert portal.runs.rows[0]["username"] == "bob" and portal.runs.rows[0]["agent"] == "pre_onboarding" and portal.runs.rows[0]["manual"] is True
    assert portal.post(f"/api/demo-runs/{run}/finish", json={"outcome": "completed"}).json() == {"closed": True}
    assert portal.post(f"/api/demo-runs/{run}/finish", json={"outcome": "failed"}).json() == {"closed": False}  # only once
    assert portal.runs.rows[0]["outcome"] == "completed"


def test_nobody_can_close_somebody_elses_run(portal):
    sign_in(portal, "bob")
    run = portal.post("/api/demo-runs", json={"agent": "payroll_salary", "mode": "simulated"}).json()["id"]
    portal.post("/api/auth/logout")
    sign_in(portal, "alice")
    assert portal.post(f"/api/demo-runs/{run}/finish", json={"outcome": "stopped"}).json() == {"closed": False}
    assert portal.runs.rows[0]["outcome"] is None


@pytest.mark.parametrize("body", [{"agent": "Bad Agent!", "mode": "live"}, {"agent": "leave_attendance", "mode": "sandbox"}, {"mode": "live"}])
def test_a_bad_demo_run_is_refused(portal, body):
    sign_in(portal, "bob")
    assert portal.post("/api/demo-runs", json=body).status_code == 422


def test_the_admin_reads_the_demo_history_and_a_normal_user_cannot(portal):
    sign_in(portal, "bob")
    one = portal.post("/api/demo-runs", json={"agent": "pre_onboarding", "mode": "live", "manual": True}).json()["id"]
    portal.post(f"/api/demo-runs/{one}/finish", json={"outcome": "failed", "detail": "ServiceNow is not set up"})
    portal.post("/api/demo-runs", json={"agent": "hr_policy", "mode": "simulated"})
    assert portal.get("/api/admin/demo-runs").status_code == 403
    portal.post("/api/auth/logout")
    sign_in(portal, "alice")
    body = portal.get("/api/admin/demo-runs").json()
    assert body["total"] == 2 and [i["agent"] for i in body["items"]] == ["hr_policy", "pre_onboarding"]  # newest first
    failed = body["items"][1]
    assert (failed["username"], failed["mode"], failed["manual"], failed["outcome"], failed["detail"], failed["seconds"]) == ("bob", "live", True, "failed", "ServiceNow is not set up", 180)
    assert body["items"][0]["endedAt"] is None and body["items"][0]["seconds"] is None  # still open
    assert portal.get("/api/admin/demo-runs?agent=hr_policy").json()["total"] == 1
    assert portal.get("/api/admin/demo-runs?username=BOB").json()["total"] == 2
    assert portal.get("/api/admin/demo-runs?username=alice").json()["total"] == 0


def test_a_failing_history_store_never_breaks_a_demo():
    class Broken(FakeRuns):
        def start(self, *args):
            raise RuntimeError("db down")

        def finish(self, *args):
            raise RuntimeError("db down")

    service = DemoRunService(Broken())
    assert service.start("hr_policy", "live", False) is None and service.finish(1, "completed", "") is False


# ------------------------------------------------------------------------------------------------ changing your own password
def change(c, current, new):
    return c.post("/api/auth/change-password", json={"currentPassword": current, "newPassword": new})


def test_a_user_changes_their_own_password_and_signs_in_with_the_new_one(portal):
    sign_in(portal, "bob")
    assert change(portal, "pass-bobbobbob", "a-brand-new-pass").json() == {"changed": True}
    assert portal.users.get("bob").password_hash.startswith("pbkdf2_sha256$")  # stored hashed
    portal.post("/api/auth/logout")
    assert portal.post("/api/auth/login", json={"username": "bob", "password": "pass-bobbobbob"}).status_code == 401
    assert portal.post("/api/auth/login", json={"username": "bob", "password": "a-brand-new-pass"}).status_code == 200


@pytest.mark.parametrize(
    ("current", "new", "message"),
    [
        ("wrong-password", "a-brand-new-pass", "current password is not correct"),
        ("pass-bobbobbob", "short", "at least 8"),
        ("pass-bobbobbob", "pass-bobbobbob", "different"),
    ],
)
def test_a_bad_password_change_is_refused_and_nothing_changes(portal, current, new, message):
    sign_in(portal, "bob")
    response = change(portal, current, new)
    assert response.status_code == 422 and message in json.dumps(response.json())
    portal.post("/api/auth/logout")
    assert portal.post("/api/auth/login", json={"username": "bob", "password": "pass-bobbobbob"}).status_code == 200


def test_nobody_signed_in_cannot_change_a_password(portal):
    assert change(portal, "pass-bobbobbob", "a-brand-new-pass").status_code == 401


def test_guessing_the_current_password_is_locked_out(portal):
    sign_in(portal, "bob")
    for _ in range(5):
        change(portal, "wrong-password", "a-brand-new-pass")
    assert change(portal, "pass-bobbobbob", "a-brand-new-pass").status_code == 429


# ------------------------------------------------------------------------------------------------ access duration & expiration
def test_create_user_with_default_10_days_access_and_first_login_flow(portal):
    from datetime import timedelta
    sign_in(portal, "alice")
    created = portal.post(
        "/api/admin/users",
        json={"username": "dave", "password": "pass-davedavedave", "fullName": "Dave K", "role": "user", "accessType": "days", "accessDays": 10},
    ).json()
    assert created["accessType"] == "days"
    assert created["accessDays"] == 10
    assert created["firstLoginAt"] is None
    assert created["expiresAt"] is None
    assert created["isExpired"] is False

    # Dave logs in for the first time
    portal.post("/api/auth/logout")
    login_res = portal.post("/api/auth/login", json={"username": "dave", "password": "pass-davedavedave"})
    assert login_res.status_code == 200

    dave_user = portal.users.get("dave")
    assert dave_user.first_login_at is not None
    assert dave_user.expires_at is not None
    assert (dave_user.expires_at - dave_user.first_login_at).days == 10


def test_expired_user_login_is_blocked_until_admin_extends_access(portal):
    from datetime import timedelta
    sign_in(portal, "alice")
    # Create user with fixed date in the past
    past_date = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    portal.post(
        "/api/admin/users",
        json={"username": "eve", "password": "pass-eveeee123", "role": "user", "accessType": "date", "expiresAt": past_date},
    )
    portal.post("/api/auth/logout")

    # Eve tries to log in
    res = portal.post("/api/auth/login", json={"username": "eve", "password": "pass-eveeee123"})
    assert res.status_code == 401
    assert "Your access has expired" in res.json()["detail"]

    # Alice extends Eve's access by 10 days
    sign_in(portal, "alice")
    patch_res = portal.patch("/api/admin/users/eve", json={"accessType": "days", "accessDays": 10})
    assert patch_res.status_code == 200
    assert patch_res.json()["isExpired"] is False
    portal.post("/api/auth/logout")

    # Eve can log in now
    assert portal.post("/api/auth/login", json={"username": "eve", "password": "pass-eveeee123"}).status_code == 200


def test_create_user_with_lifetime_access(portal):
    sign_in(portal, "alice")
    res = portal.post(
        "/api/admin/users",
        json={"username": "frank", "password": "pass-frank1234", "role": "user", "accessType": "lifetime"},
    ).json()
    assert res["accessType"] == "lifetime"
    assert res["expiresAt"] is None
    assert res["isExpired"] is False



# ------------------------------------------------------------------------------------------------ asking for access
def ask(c, name="Carol Dsouza", email="carol.dsouza@example.com"):
    return c.post("/api/auth/request-access", json={"fullName": name, "email": email})


def test_anyone_can_ask_for_access_from_the_login_page(portal):
    assert ask(portal).status_code == 202  # nobody is signed in
    assert ask(portal).status_code == 202  # asking again while waiting does not add a second request
    assert len(portal.requests.rows) == 1
    assert ask(portal, email="not-an-email").status_code == 422
    assert ask(portal, name=" ").status_code == 422


def test_requests_are_limited_per_computer(portal):
    for n in range(5):
        assert ask(portal, email=f"p{n}@example.com").status_code == 202
    assert ask(portal, email="p9@example.com").status_code == 429


def test_only_an_admin_sees_the_requests(portal):
    ask(portal)
    assert portal.get("/api/admin/access-requests").status_code == 401
    sign_in(portal, "bob")
    assert portal.get("/api/admin/access-requests").status_code == 403
    assert portal.post("/api/admin/access-requests/1/approve", json={}).status_code == 403
    sign_in(portal, "alice")
    rows = portal.get("/api/admin/access-requests").json()
    assert [(r["email"], r["status"]) for r in rows] == [("carol.dsouza@example.com", "pending")]


def test_approving_makes_a_normal_user_and_e_mails_the_login(portal):
    ask(portal)
    sign_in(portal, "alice")
    done = portal.post("/api/admin/access-requests/1/approve", json={})
    assert done.status_code == 200 and done.json()["status"] == "approved" and done.json()["username"] == "carol.dsouza@example.com"
    user = portal.users.get("carol.dsouza@example.com")
    assert (user.role, user.access_type, user.access_days, user.full_name) == ("user", "days", 13, "Carol Dsouza")
    to, _, body = portal.mail.sent[0]
    assert to == "carol.dsouza@example.com" and "User name: <b>carol.dsouza@example.com</b>" in body
    password = body.split("Password: <b>")[1].split("</b>")[0]
    assert portal.post("/api/auth/login", json={"username": "carol.dsouza@example.com", "password": password}).status_code == 200
    sign_in(portal, "alice")
    assert portal.post("/api/admin/access-requests/1/approve", json={}).status_code == 409  # decided once


def test_the_admin_can_change_the_role_and_access_when_approving(portal):
    ask(portal)
    sign_in(portal, "alice")
    portal.post("/api/admin/access-requests/1/approve", json={"role": "admin", "accessType": "lifetime"})
    user = portal.users.get("carol.dsouza@example.com")
    assert (user.role, user.access_type, user.access_days) == ("admin", "lifetime", None)


def test_the_full_e_mail_is_the_user_name_and_an_existing_account_is_refused(portal):
    portal.users.save(person("dave@example.com"))
    ask(portal, email="dave@example.com")
    sign_in(portal, "alice")
    assert portal.post("/api/admin/access-requests/1/approve", json={}).status_code == 409
    assert portal.requests.rows[0]["status"] == "pending"


def test_the_e_mailed_password_has_to_be_changed_at_the_first_sign_in(portal):
    ask(portal)
    sign_in(portal, "alice")
    portal.post("/api/admin/access-requests/1/approve", json={})
    password = portal.mail.sent[0][2].split("Password: <b>")[1].split("</b>")[0]
    assert portal.users.get("carol.dsouza@example.com").must_change_password is True
    assert portal.post("/api/auth/login", json={"username": "carol.dsouza@example.com", "password": password}).status_code == 200
    assert portal.get("/api/auth/me").json()["mustChangePassword"] is True
    assert portal.post("/api/auth/change-password", json={"currentPassword": password, "newPassword": "my-own-secret"}).status_code == 200
    assert portal.get("/api/auth/me").json()["mustChangePassword"] is False
    sign_in(portal, "bob")
    assert portal.get("/api/auth/me").json()["mustChangePassword"] is False  # people added by an admin are not asked


def test_nothing_is_created_when_the_e_mail_cannot_be_sent(portal):
    ask(portal)
    sign_in(portal, "alice")
    portal.mail.configured = False
    assert portal.post("/api/admin/access-requests/1/approve", json={}).status_code == 502
    assert portal.users.get("carol.dsouza@example.com") is None
    assert portal.requests.rows[0]["status"] == "pending"


def test_rejecting_tells_the_person_and_creates_nobody(portal):
    ask(portal)
    sign_in(portal, "alice")
    done = portal.post("/api/admin/access-requests/1/reject")
    assert done.status_code == 200 and done.json()["status"] == "rejected" and done.json()["emailed"] is True
    assert portal.users.get("carol.dsouza@example.com") is None
    assert portal.mail.sent[0][0] == "carol.dsouza@example.com"
    assert portal.post("/api/admin/access-requests/1/reject").status_code == 409

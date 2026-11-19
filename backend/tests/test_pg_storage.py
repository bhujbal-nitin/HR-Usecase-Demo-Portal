"""The PostgreSQL storage, users and token tracking, run against the real database from .env inside a throw-away schema.

Skipped when no database is configured or it cannot be reached (so the suite still passes on a machine without PostgreSQL).
"""

import json
import uuid

import psycopg
import pytest
from psycopg import sql

from app.core.config import Settings
from app.core.exceptions import ConflictError, NotFoundError
from app.core.passwords import hash_password
from app.repositories.database import Database
from app.repositories.pg_store import PgEmployeeRepository, PgLeaveRepository
from app.repositories.usage_repository import PostgresUsageRepository, UsageCall
from app.repositories.user_repository import PortalUser, PostgresUserRepository
from app.schemas.employee import Employee
from app.schemas.leave import LeaveAttendanceRequest


def _real_settings() -> Settings | None:
    try:
        s = Settings()
    except Exception:  # noqa: BLE001
        return None
    return s if s.pg_database and s.pg_user else None


@pytest.fixture
def db(tmp_path):
    base = _real_settings()
    if base is None:
        pytest.skip("no PostgreSQL configured in .env")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    settings = base.model_copy(update={"pg_schema": schema})
    database = Database(settings)
    try:
        database.ensure_schema_exists()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"PostgreSQL is not reachable: {exc}")
    yield database
    with psycopg.connect(
        host=base.pg_host, port=base.pg_port, dbname=base.pg_database, user=base.pg_user, password=base.pg_password.get_secret_value(), autocommit=True
    ) as conn:
        conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))


def employee(emp_id: str, name: str = "Aarav Sharma") -> Employee:
    return Employee.model_validate({
        "id": emp_id, "fullName": name, "email": "aarav@example.com", "phone": "+91 98765 43210", "dob": "1995-07-20",
        "aadhaar": "234567890123", "emergencyName": "Sunita Sharma", "emergencyPhone": "+91 98765 00000",
        "address": "Flat 402, Baner, Pune", "department": "Engineering", "jobTitle": "Engineer", "manager": "Amit Deshmukh",
        "startDate": "2026-12-01", "annualCtc": 3450000, "hardware": "MacBook Pro",
    })


def leave_request(request_id: str) -> LeaveAttendanceRequest:
    return LeaveAttendanceRequest.model_validate({
        "id": request_id, "kind": "leave", "employeeId": "AE-000001", "fullName": "Aarav Sharma", "workEmail": "aarav@example.com",
        "department": "Engineering", "jobTitle": "Engineer", "manager": "Amit Deshmukh", "reason": "Family function",
    })


# ------------------------------------------------------------------------------------------------ records
def test_records_keep_newest_first_update_atomically_and_delete(db):
    repo = PgEmployeeRepository(db)
    repo.add(employee("AE-000001"))
    repo.add(employee("AE-000002", "Second Person"))
    assert [e.id for e in repo.list_all()] == ["AE-000002", "AE-000001"]  # newest first, like the JSON store

    repo.update("AE-000001", lambda e: setattr(e, "full_name", "Changed Name"))
    assert repo.require("AE-000001").full_name == "Changed Name"

    def refuse(e):
        e.full_name = "Never saved"
        raise ConflictError("no")

    with pytest.raises(ConflictError):
        repo.update("AE-000001", refuse)
    assert repo.require("AE-000001").full_name == "Changed Name"  # the failed update saved nothing
    assert [e.id for e in repo.list_all()] == ["AE-000002", "AE-000001"]  # and the order did not change

    with pytest.raises(NotFoundError):
        repo.require("AE-999999")
    assert [e.id for e in repo.delete_where(lambda e: e.id == "AE-000002")] == ["AE-000002"]
    assert [e.id for e in repo.list_all()] == ["AE-000001"]


def test_old_json_file_is_imported_once_and_left_alone(db, tmp_path):
    file = tmp_path / "employees.json"
    records = [employee("AE-000003", "Newest").model_dump(mode="json", by_alias=True), employee("AE-000002", "Older").model_dump(mode="json", by_alias=True)]
    file.write_text(json.dumps({"employees": records}), encoding="utf-8")
    before = file.read_text(encoding="utf-8")

    repo = PgEmployeeRepository(db, file)
    assert [e.id for e in repo.list_all()] == ["AE-000003", "AE-000002"]  # same order as in the file
    assert file.read_text(encoding="utf-8") == before  # the backup is untouched

    repo.delete_where(lambda e: e.id == "AE-000003")
    assert [e.id for e in PgEmployeeRepository(db, file).list_all()] == ["AE-000002"]  # a restart does not import it again


def test_leave_style_repositories_support_a_guarded_add(db):
    repo = PgLeaveRepository(db)
    repo.add_if(leave_request("LV-1"), lambda records: None)
    with pytest.raises(ConflictError):
        repo.add_if(leave_request("LV-2"), lambda records: (_ for _ in ()).throw(ConflictError("overlaps")))
    assert [r.id for r in repo.list_all()] == ["LV-1"]
    assert repo.delete_where(lambda r: r.id == "LV-1") == 1


# ------------------------------------------------------------------------------------------------ users and usage
def test_users_have_roles_and_the_first_user_becomes_the_admin(db):
    users = PostgresUserRepository(db)
    users.ensure_schema()
    with db.connect() as conn:  # a user created before roles existed
        conn.execute("INSERT INTO portal_users (username, password_hash) VALUES ('old.user', 'x')")
    users.ensure_schema()
    assert users.get("OLD.user").role == "admin"

    users.save(PortalUser("carol", hash_password("longenough1"), "Carol", True, "user"))
    users.save(PortalUser("Carol", hash_password("another-long1"), "Carol N", True, "admin"))  # same name, any capitalisation
    assert [u.username for u in users.list_all()] == ["old.user", "carol"]
    assert users.get("carol").role == "admin" and users.get("carol").full_name == "Carol N"
    users.ensure_schema()
    assert users.get("old.user").role == "admin" and users.get("carol").role == "admin"  # re-running changes nothing


def test_usage_totals_and_history_per_user(db):
    usage = PostgresUsageRepository(db)
    usage.ensure_schema()
    usage.record(UsageCall("bob", "Reimbursement bill", "gemini-2.5-flash", 100, 10, 110))
    usage.record(UsageCall("BOB", "Onboarding document check", "gemini-2.5-flash", 200, 20, 220))
    usage.record(UsageCall("alice", "Reimbursement bill", "gemini-2.5-flash", 5, 5, 10))

    totals = {r["username"].lower(): r for r in usage.totals()}
    assert totals["bob"]["calls"] == 2 and totals["bob"]["total_tokens"] == 330 and totals["bob"]["input_tokens"] == 300
    assert usage.totals(days=1)[0]["username"].lower() == "bob"  # biggest first
    rows, total = usage.history("bob", 10, 0)
    assert total == 2 and rows[0]["feature"] == "Onboarding document check"  # newest first
    assert usage.history(None, 1, 1)[1] == 3 and len(usage.history(None, 1, 1)[0]) == 1


def test_preonboarding_candidates_are_kept_in_the_database_and_imported_from_the_json_file(db, tmp_path):
    from app.repositories.pg_store import PgPreOnboardingRepository
    from app.schemas.preonboarding import PreCandidate, PreStatus

    candidate = PreCandidate.model_validate({
        "id": "PRE-100001", "fullName": "Priya Anil Nair", "email": "p@example.com", "phone": "+91 98200 11223", "designation": "Engineer",
        "department": "Engineering", "manager": "M", "location": "Pune", "annualCtc": 3450000, "joiningDate": "2027-01-04",
    })
    file = tmp_path / "preonboarding.json"
    file.write_text(json.dumps({"candidates": [candidate.model_dump(mode="json", by_alias=True)]}), encoding="utf-8")
    repo = PgPreOnboardingRepository(db, file)
    assert [c.id for c in repo.list_all()] == ["PRE-100001"]  # imported once
    repo.update("PRE-100001", lambda c: setattr(c, "status", PreStatus.REJECTED))
    assert repo.require("PRE-100001").status == PreStatus.REJECTED
    assert [c.id for c in repo.delete_where(lambda c: c.status == PreStatus.REJECTED)] == ["PRE-100001"]
    assert repo.list_all() == []

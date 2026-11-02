import time
from collections.abc import Iterator
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


@pytest.fixture
def settings(tmp_path) -> Settings:
    """Settings with no integration credentials, isolated storage and no background poller."""
    return Settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        offers_dir=tmp_path / "offers",
        hr_documents_dir=tmp_path / "hr_documents",
        approval_poller_enabled=False,
        cors_origins="http://localhost:3000",
    )


@pytest.fixture
def client(settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def candidate_form() -> dict[str, str]:
    return {
        "fullName": "Aarav Sharma",
        "email": "aarav.sharma@example.com",
        "phone": "+91 98765 43210",
        "dob": "1995-07-20",
        "aadhaar": "2345 6789 0123",
        "uan": "101298452310",
        "emergencyName": "Sunita Sharma (Mother)",
        "emergencyPhone": "+91 98765 00000",
        "address": "Flat 402, Marvel Palms, Baner, Pune, Maharashtra 411045",
        "department": "Engineering",
        "jobTitle": "Staff AI Systems Engineer",
        "manager": "Amit Deshmukh (VP of Engineering)",
        "startDate": (date.today() + timedelta(days=14)).isoformat(),
        "annualCtc": "3450000",
        "hardware": "Apple MacBook Pro M3 Max",
        "workLocation": "Hybrid",
        "signature": PNG_DATA_URL,
    }


@pytest.fixture
def candidate_files() -> dict[str, tuple[str, bytes, str]]:
    return {
        "idDoc": ("aadhaar.pdf", PDF, "application/pdf"),
        "panDoc": ("pan.pdf", PDF, "application/pdf"),
        "uanDoc": ("uan.pdf", PDF, "application/pdf"),
        "salaryDoc": ("payslips.pdf", PDF, "application/pdf"),
    }


def wait_for(predicate, timeout: float = 15.0, interval: float = 0.1):
    """Poll until ``predicate`` returns a truthy value (background tasks are asynchronous)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    raise AssertionError("condition not met within timeout")

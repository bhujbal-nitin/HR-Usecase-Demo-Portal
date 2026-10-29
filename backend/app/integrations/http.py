"""Shared HTTP session factory for outbound integrations."""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_TIMEOUT = 20


def build_session(verify_ssl: bool = True) -> requests.Session:
    """Session that retries transient gateway errors on idempotent verbs only.

    POST is deliberately excluded: re-sending a POST could create duplicate
    records (requests, incidents, users) in the target system.
    """
    retry = Retry(
        total=2,
        backoff_factor=0.5,
        status_forcelist=(502, 503, 504),
        allowed_methods=frozenset({"GET", "PUT", "DELETE", "HEAD"}),
        raise_on_status=False,
    )
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.verify = verify_ssl
    return session


def error_text(response: requests.Response, limit: int = 300) -> str:
    """Best-effort short description of a failed response."""
    try:
        body = response.json()
        detail = body.get("error") or body.get("message") or body
        if isinstance(detail, dict):
            detail = detail.get("message") or detail.get("detail") or detail
        text = str(detail)
    except ValueError:
        text = response.text
    return f"HTTP {response.status_code}: {text[:limit]}"

"""Signed session tokens kept in the browser's cookie: ``<payload>.<signature>`` (HMAC-SHA256), no server-side session store."""

import base64
import hashlib
import hmac
import json
import time


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: str, payload: str) -> str:
    return _b64(hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def issue(secret: str, username: str, lifetime_seconds: int, now: float | None = None) -> str:
    payload = _b64(json.dumps({"u": username, "exp": int((now or time.time()) + lifetime_seconds)}).encode("utf-8"))
    return f"{payload}.{_sign(secret, payload)}"


def read(secret: str, token: str | None, now: float | None = None) -> str | None:
    """The user name in a valid, unexpired token; None for anything else."""
    if not token or token.count(".") != 1:
        return None
    payload, signature = token.split(".")
    if not hmac.compare_digest(signature, _sign(secret, payload)):
        return None
    try:
        data = json.loads(_unb64(payload))
        return data["u"] if data["exp"] > (now or time.time()) else None
    except (ValueError, KeyError, TypeError):
        return None

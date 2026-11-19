"""Password hashes for the portal's login (standard library only): ``pbkdf2_sha256$<iterations>$<salt>$<hash>``."""

import base64
import hashlib
import hmac
import secrets

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 390_000


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _derive(password: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{_ALGORITHM}${_ITERATIONS}${_b64(salt)}${_b64(_derive(password, salt, _ITERATIONS))}"


def verify_password(password: str, stored: str) -> bool:
    """True when ``password`` matches ``stored``; a malformed hash never matches."""
    try:
        algorithm, iterations, salt, expected = stored.split("$")
        if algorithm != _ALGORITHM:
            return False
        actual = _derive(password, base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


# Checked when the user name is unknown, so a wrong user name takes as long as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(12))

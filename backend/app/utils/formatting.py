"""Small pure helpers shared by services and integrations."""

import re
import secrets
import string


def format_inr(amount: int, symbol: str = "₹") -> str:
    """Format an integer using Indian digit grouping, e.g. 3200000 -> ₹32,00,000.

    Pass ``symbol="INR "`` where the rupee glyph is unavailable (PDF base fonts).
    """
    digits = str(abs(int(amount)))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return f"{'-' if amount < 0 else ''}{symbol}{digits}"


def format_lpa(amount: int) -> str:
    return f"{amount / 100000:.1f} LPA"


def split_name(full_name: str) -> tuple[str, str, str]:
    """Return (first, middle, last). A single-word name has an empty last name."""
    parts = full_name.strip().split()
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def safe_filename(name: str) -> str:
    """Reduce a user-provided string to a conservative file-name fragment."""
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", name.strip()).strip("._")
    return cleaned or "file"


def generate_temporary_password(length: int = 14) -> str:
    """Random password that satisfies common directory complexity rules."""
    rng = secrets.SystemRandom()
    symbols = "!@#$%^&*"
    chars = [
        rng.choice(string.ascii_uppercase),
        rng.choice(string.ascii_lowercase),
        rng.choice(string.digits),
        rng.choice(symbols),
    ]
    pool = string.ascii_letters + string.digits + symbols
    chars += [rng.choice(pool) for _ in range(max(length, 8) - len(chars))]
    rng.shuffle(chars)
    return "".join(chars)

"""Who is making the current request, and which feature is using the AI right now (read by the token tracking)."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

NO_LOGIN = "(login off)"

current_user: ContextVar[str | None] = ContextVar("current_user", default=None)
current_feature: ContextVar[str] = ContextVar("current_feature", default="Other")


@contextmanager
def feature(name: str) -> Iterator[None]:
    """Label the AI calls made inside the block, e.g. ``with feature("Reimbursement bill"):``."""
    token = current_feature.set(name)
    try:
        yield
    finally:
        current_feature.reset(token)

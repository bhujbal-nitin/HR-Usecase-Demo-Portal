"""Synchronous retry decorator with exponential backoff."""

import functools
import logging
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


def retry_on_failure(
    max_retries: int = 2,
    initial_delay: float = 1.0,
    backoff_factor: float = 2.0,
    exceptions: tuple[type[BaseException], ...] = (Exception,),
    giveup_on: tuple[type[BaseException], ...] = (),
) -> Callable:
    """Retry the wrapped function on ``exceptions``; never retry ``giveup_on``."""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            delay = initial_delay
            for attempt in range(1, max_retries + 2):
                try:
                    return func(*args, **kwargs)
                except giveup_on:
                    raise
                except exceptions as exc:
                    if attempt > max_retries:
                        logger.error("%s failed permanently after %d attempts: %s", func.__name__, attempt, exc)
                        raise
                    logger.warning(
                        "%s failed (attempt %d/%d): %s - retrying in %.1fs",
                        func.__name__, attempt, max_retries + 1, exc, delay,
                    )
                    time.sleep(delay)
                    delay *= backoff_factor

        return wrapper

    return decorator

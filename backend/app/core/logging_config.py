"""Logging bootstrap."""

import logging


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Keep third-party chatter down; our own loggers stay at INFO.
    logging.getLogger("urllib3").setLevel(logging.WARNING)

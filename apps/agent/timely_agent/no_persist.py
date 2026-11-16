"""No-persist runs (phase 4, Q-4.2; phase 8, Q7): which runs are no-persist, and keeping their
text out of Hermes' log files.

A run is no-persist when ``run.start.flags.no_persist`` or ``run.start.no_persist`` is true, and
always when ``flags.sensitive`` is true: a Sensitive chat never leaves anything in the account
home, whatever Go sent (``wanted``). ``mark`` writes the answer into ``flags.no_persist`` so every
reader of the run's flags (the log filter below, ``delegation``, ``run_chat``) agrees.

Hermes logs each turn at INFO into ``<home>/logs/agent.log`` (``agent.turn_context`` writes the
person's message: ``msg='...'``), through one queue handler on the root logger
(``hermes_logging._register_queued_handler``). A no-persist run must leave nothing in the home, so
while one is live:

- the queue handler (and any other Hermes handler on the root logger) drops every record: a
  record from a thread that did not copy the run's context (an HTTP client thread) cannot be told
  apart, so other runs of the account lose their log lines for that time;
- the worker's own stderr handler drops the run's records (its context names the run), so the
  person's text does not reach the API log either; other runs keep logging there.

Standard ``logging`` filters on the handlers: no patch point. ``scope()`` wraps the run; ``prime``
runs Hermes' own ``setup_logging`` first so the handlers exist before the run's first record.
"""

from __future__ import annotations

import contextlib
import logging
import threading
from pathlib import Path
from typing import Any, Iterator, Optional

from timely_agent import bridge


def wanted(msg: dict[str, Any]) -> bool:
    """The run must persist nothing: no-persist asked for, or a Sensitive chat."""
    flags = msg.get("flags") if isinstance(msg.get("flags"), dict) else {}
    return flags.get("no_persist") is True or msg.get("no_persist") is True or flags.get("sensitive") is True


def mark(msg: dict[str, Any]) -> bool:
    """Set ``flags.no_persist`` when the run is no-persist (see ``wanted``); returns it."""
    if not wanted(msg):
        return False
    flags = msg.get("flags") if isinstance(msg.get("flags"), dict) else {}
    msg["flags"] = {**flags, "no_persist": True}
    return True


_live = 0
_lock = threading.Lock()


def live() -> int:
    with _lock:
        return _live


def _run_is_no_persist() -> bool:
    try:
        run = bridge.current_run.get()
    except Exception:
        return False
    return run is not None and (run.flags or {}).get("no_persist") is True


class NoPersistFilter(logging.Filter):
    """Drops records a no-persist run must not leave behind (see the module docstring)."""

    def __init__(self, hermes_file: bool):
        super().__init__("timely-no-persist")
        self.hermes_file = hermes_file

    def filter(self, record: logging.LogRecord) -> bool:
        if _run_is_no_persist():
            return False
        return not (self.hermes_file and live() > 0)


def install(stderr_handler: Optional[logging.Handler] = None) -> int:
    """Put the filter on every root handler that lacks it; returns how many were added."""
    added = 0
    for handler in list(logging.getLogger().handlers):
        if any(isinstance(f, NoPersistFilter) for f in handler.filters):
            continue
        ours = handler is stderr_handler or getattr(handler, "_timely_stderr", False)
        handler.addFilter(NoPersistFilter(hermes_file=not ours))
        added += 1
    return added


def prime(home: Path) -> None:
    """Hermes' logging set up for the home (idempotent), then the filters on its handlers."""
    try:
        from hermes_logging import setup_logging
        setup_logging(hermes_home=Path(home))
    except Exception:
        logging.getLogger("timely_agent.no_persist").debug("hermes logging setup failed", exc_info=True)
    install()


@contextlib.contextmanager
def scope(home: Path) -> Iterator[None]:
    """A no-persist run is live: Hermes' file logs take no record until it ends."""
    global _live
    prime(home)
    with _lock:
        _live += 1
    try:
        yield
    finally:
        install()  # a handler Hermes added during the run (none expected) is covered from now on
        with _lock:
            _live -= 1

"""``busy.learning``: true while a learning pass or the curator runs (Go never reaps the worker then).

A learning pass is Hermes' background review: ``finalize_turn`` spawns it on a daemon thread
inside ``run_conversation`` and installs a run token on the agent
(``agent._background_review_run``, an ``_BackgroundReviewRun`` whose ``request_done`` event is set
once the fork's writes are over). ``watch`` waits on that token on a thread of its own, then calls
``after`` (the feed's re-diff).
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterator

logger = logging.getLogger("timely_agent.learning")

PASS_TIMEOUT_S = 900.0  # a review is bounded by Hermes (16 iterations); never hold busy forever

_lock = threading.Lock()
_active = 0


def active() -> bool:
    with _lock:
        return _active > 0


def count() -> int:
    with _lock:
        return _active


@contextmanager
def busy() -> Iterator[None]:
    global _active
    with _lock:
        _active += 1
    try:
        yield
    finally:
        with _lock:
            _active -= 1


def pending_review(agent: Any) -> Any:
    """The agent's live review token, or None when no learning pass is running."""
    token = getattr(agent, "_background_review_run", None)
    done = getattr(token, "request_done", None)
    if token is None or done is None or done.is_set():
        return None
    return token


def watch(agent: Any, after: Callable[[], None], timeout: float = PASS_TIMEOUT_S) -> bool:
    """When a learning pass is running on ``agent``, mark the worker busy until it ends, then run
    ``after``. Returns whether a pass was found."""
    token = pending_review(agent)
    if token is None:
        return False
    global _active
    with _lock:
        _active += 1

    def wait() -> None:
        global _active
        try:
            token.request_done.wait(timeout)
            after()
        except Exception:
            logger.exception("after the learning pass")
        finally:
            with _lock:
                _active -= 1

    threading.Thread(target=wait, name="timely-learning-pass", daemon=True).start()
    return True

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
import time
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


USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
              "api_calls")


def usage(fork: Any) -> dict[str, Any]:
    """The pass's own token use (Hermes' review fork counters; plan 9b.8: learning tokens are
    counted apart from the turn's, which ``run.done`` carries)."""
    if fork is None:
        return {}
    out: dict[str, Any] = {k: int(getattr(fork, f"session_{k}", 0) or 0) for k in USAGE_KEYS}
    out["model"] = str(getattr(fork, "model", "") or "")
    cost = getattr(fork, "session_estimated_cost_usd", None)
    out["estimated_cost_usd"] = cost if isinstance(cost, (int, float)) else None
    return out


def watch(agent: Any, after: Callable[[], None], timeout: float = PASS_TIMEOUT_S,
          on_usage: Callable[[dict[str, Any]], None] | None = None) -> bool:
    """When a learning pass is running on ``agent``, mark the worker busy until it ends, then run
    ``after`` and hand the pass's token use to ``on_usage``. Returns whether a pass was found."""
    token = pending_review(agent)
    if token is None:
        return False
    global _active
    with _lock:
        _active += 1

    def wait() -> None:
        global _active
        try:
            # Hermes drops the token's fork when the request finishes: keep hold of it meanwhile.
            fork = getattr(token, "_review_agent", None)
            deadline = time.monotonic() + timeout
            while not token.request_done.wait(0.1) and time.monotonic() < deadline:
                fork = getattr(token, "_review_agent", None) or fork
            after()
            spent = usage(fork)
            if on_usage is not None and any(spent.get(k) for k in USAGE_KEYS):
                on_usage(spent)
        except Exception:
            logger.exception("after the learning pass")
        finally:
            with _lock:
                _active -= 1

    threading.Thread(target=wait, name="timely-learning-pass", daemon=True).start()
    return True

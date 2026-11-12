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


def install_end_turn() -> None:
    """Let a turn that Timely ended after a recorded proposal (Q-2.4's ``end_turn``) still start
    the learning pass that was due (idempotent; the worker calls it once Hermes is imported).

    ``timely_gate`` ends such a turn with ``agent.interrupt``, so Hermes' ``finalize_turn`` sees an
    interrupted turn: it uses up the due review counters, then spawns no review. ``end_turn`` is the
    turn finishing, not a Stop, so the wrapper hands Hermes the turn as not interrupted when this
    run's gate ended it and the person did not press Stop. A real Stop keeps Hermes' behaviour (no
    review)."""
    import agent.turn_finalizer as turn_finalizer
    original = turn_finalizer._mirror_turn_to_memory
    if getattr(original, "__timely_end_turn__", False):
        return

    def mirror(agent: Any, *, original_user_message: Any, final_response: Any, interrupted: bool,
               messages: Any, review_memory: bool, review_skills: bool, vetoed: bool) -> None:
        if interrupted and not vetoed and (review_memory or review_skills) and ended_by_timely(agent):
            interrupted = False
            final_response = final_response or closing_text(messages) or "Recorded the proposal."
        original(agent, original_user_message=original_user_message, final_response=final_response,
                 interrupted=interrupted, messages=messages, review_memory=review_memory,
                 review_skills=review_skills, vetoed=vetoed)

    mirror.__timely_end_turn__ = True  # type: ignore[attr-defined]
    turn_finalizer._mirror_turn_to_memory = mirror


def ended_by_timely(agent: Any) -> bool:
    """Whether this thread's run ended its turn through ``end_turn`` (not a Stop) on ``agent``."""
    from timely_agent import bridge
    run = bridge.current_run.get()
    if run is None or not run.end_turn_hit or run.agent is not agent:
        return False
    try:
        return not run.stopped()
    except Exception:
        return False


def closing_text(messages: Any) -> str:
    """The last non-empty assistant text of a turn's messages."""
    for message in reversed(messages or []):
        if isinstance(message, dict) and message.get("role") == "assistant":
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return ""


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

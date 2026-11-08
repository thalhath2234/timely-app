"""What Timely's plugins know about the run they are called in (worker <-> plugin seam).

The worker sets a :class:`RunContext` in the run thread's context (``contextvars``), and
installs ``ask`` (a function that sends a worker -> Go request and waits for the reply). Plugin
hooks read both; outside a worker (unit tests, a plain Hermes process) there is no context and
the gate fails closed.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# Pipe hook calls must answer inside Hermes' hook timeout (plugins.hook_callback_timeout, 30 s,
# fails closed). Leave a margin for the hook machinery itself.
HOOK_ANSWER_TIMEOUT_S = 25.0


@dataclass
class RunContext:
    run_id: str
    session_key: str
    conversation_id: str
    kind: str = "chat"  # "chat" | "bot"
    tainted_sources: list[dict[str, Any]] = field(default_factory=list)
    pre_approved: Optional[dict[str, Any]] = None


current_run: contextvars.ContextVar[Optional[RunContext]] = contextvars.ContextVar("timely_run", default=None)

# Set by the worker: ask(message, timeout) -> reply dict or None.
ask: Optional[Callable[[dict, float], Optional[dict]]] = None

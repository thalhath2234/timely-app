"""What Timely's plugins know about the run they are called in (worker <-> plugin seam).

The worker sets a :class:`RunContext` in the run thread's context (``contextvars``; Hermes carries
it into tool worker threads with ``propagate_context_to_thread``), and installs ``ask`` (a function
that sends a worker -> Go request and waits for the reply) and ``notify`` (a one-way worker -> Go
message). Plugin hooks read both; outside a worker (unit tests, a plain Hermes process) there is
no context and the gate fails closed.

The Timely tool specs from ``hello.timely_tools`` are kept here (``set_timely_tools``) before
Hermes discovers the plugins, so ``timely_tools.register`` can register them.
"""

from __future__ import annotations

import contextvars
import json
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# Pipe hook calls must answer inside Hermes' hook timeout (plugins.hook_callback_timeout, 30 s,
# fails closed). Leave a margin for the hook machinery itself.
HOOK_ANSWER_TIMEOUT_S = 25.0
# A Timely tool call is a registered tool, not a hook, so it is bounded by Hermes' tool timeout
# instead: Go answers most calls at once, preview_bot (a page read) can take longer.
TOOL_ANSWER_TIMEOUT_S = 180.0

PERMISSIONS = ("supervised", "auto", "full")


@dataclass
class Batch:
    """The tool calls of one assistant message (``post_api_request``), in call order."""
    ids: list[str]
    names: list[str]

    @property
    def size(self) -> int:
        return len(self.names)

    def siblings(self, tool_call_id: str, tool_name: str = "") -> list[str]:
        """The other tool names in the batch (each call but this one, in order)."""
        out = list(self.names)
        if tool_call_id in self.ids:
            del out[self.ids.index(tool_call_id)]
        elif tool_name in out:
            out.remove(tool_name)
        return out


@dataclass
class RunContext:
    run_id: str
    session_key: str
    conversation_id: str
    kind: str = "chat"  # "chat" | "bot"
    tainted_sources: list[dict[str, Any]] = field(default_factory=list)
    pre_approved: Optional[dict[str, Any]] = None
    # run.start.permission: stored, not acted on in phase 2 (Go applies it to proposals).
    permission: str = "supervised"
    flags: dict[str, Any] = field(default_factory=dict)
    # The live AIAgent (set by run_chat once built), so a hook can end the turn.
    agent: Any = None
    # Flushes coalesced stream text before a Timely tool call goes to Go.
    flush: Optional[Callable[[], None]] = None
    # Q-2.4: Go answered a recorded propose_changes with end_turn; the next tool call ends the turn.
    end_turn: bool = False
    end_turn_hit: bool = False
    _batches: dict[str, Batch] = field(default_factory=dict, repr=False)
    _last_batch: Optional[Batch] = field(default=None, repr=False)
    _last_call: dict[str, str] = field(default_factory=dict, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def learning_writes(self) -> bool:
        """``flags.learning_writes`` is exactly true (phase 2: always false, so writes are off)."""
        return self.flags.get("learning_writes") is True

    # ------------------------------------------------------------ batches
    def record_batch(self, calls: list[tuple[str, str]]) -> Batch:
        """Remember the ``(tool_call_id, name)`` pairs of one assistant message."""
        batch = Batch(ids=[c[0] for c in calls], names=[c[1] for c in calls])
        with self._lock:
            self._last_batch = batch
            for call_id in batch.ids:
                if call_id:
                    self._batches[call_id] = batch
        return batch

    def batch_for(self, tool_call_id: str, tool_name: str = "") -> Optional[Batch]:
        """The batch a call came in: by its id, else the latest model response when that holds
        the tool. Hermes renames a call id the conversation already used (``call_1`` ->
        ``call_1_d2``, ``agent_runtime_helpers._dedupe_tool_call_ids``) after the hook saw it;
        the tools of one response all run before the next response is recorded."""
        with self._lock:
            batch = self._batches.get(tool_call_id or "")
            if batch is not None and (not tool_name or tool_name in batch.names):
                return batch
            last = self._last_batch
            if last is not None and tool_name and tool_name in last.names:
                return last
            return None

    def note_call(self, tool_name: str, tool_call_id: str) -> None:
        """The gate saw this call (the handler's fallback when the call id is not in context)."""
        with self._lock:
            self._last_call[tool_name] = tool_call_id

    def last_call(self, tool_name: str) -> str:
        with self._lock:
            return self._last_call.get(tool_name, "")

    # ------------------------------------------------------------ taint
    def add_taint(self, sources: list[Any]) -> list[Any]:
        """Append the sources not seen yet (append-only, deduplicated by canonical JSON); returns
        the new ones."""
        new = []
        with self._lock:
            seen = {_source_key(s) for s in self.tainted_sources}
            for source in sources:
                key = _source_key(source)
                if key not in seen:
                    seen.add(key)
                    self.tainted_sources.append(source)
                    new.append(source)
        return new

    def taint_snapshot(self) -> list[Any]:
        with self._lock:
            return list(self.tainted_sources)


def _source_key(source: Any) -> str:
    return json.dumps(source, sort_keys=True, separators=(",", ":"), default=str)


current_run: contextvars.ContextVar[Optional[RunContext]] = contextvars.ContextVar("timely_run", default=None)

# Set by the worker: ask(message, timeout) -> reply dict or None.
ask: Optional[Callable[[dict, float], Optional[dict]]] = None
# Set by the worker: notify(message) -> sent; for messages with no reply (taint).
notify: Optional[Callable[[dict], bool]] = None


def report_taint(run: RunContext, sources: list[Any]) -> list[Any]:
    """Add ``sources`` to the run's taint and send ``taint`` for the new ones (plan 5.2, 9b.2)."""
    new = run.add_taint(sources)
    if new and notify is not None:
        notify({"type": "taint", "run": run.run_id, "sources": new})
    return new


# ---------------------------------------------------------------- Timely tool specs (hello)

_timely_tools: list[dict[str, Any]] = []
_timely_catalog_version: str = ""


def set_timely_tools(tools: list[dict[str, Any]], catalog_version: str = "") -> None:
    """The specs from ``hello.timely_tools`` (validated by the worker); set before plugins load."""
    global _timely_tools, _timely_catalog_version
    _timely_tools = [dict(t) for t in tools]
    _timely_catalog_version = str(catalog_version or "")


def timely_tools() -> list[dict[str, Any]]:
    return [dict(t) for t in _timely_tools]


def timely_catalog_version() -> str:
    return _timely_catalog_version

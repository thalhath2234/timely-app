"""What Timely's plugins know about the run they are called in (worker <-> plugin seam).

The worker sets a :class:`RunContext` in the run thread's context (``contextvars``; Hermes carries
it into tool worker threads with ``propagate_context_to_thread``), and installs ``ask`` (a function
that sends a worker -> Go request and waits for the reply) and ``notify`` (a one-way worker -> Go
message). Plugin hooks read both; outside a worker (unit tests, a plain Hermes process) there is
no context and the gate fails closed.

The Timely tool specs from ``hello.timely_tools`` are kept here (``set_timely_tools``) before
Hermes discovers the plugins, so ``timely_tools.register`` can register them.

**Sessions outlive runs (phase 3).** Each conversation has a :class:`SessionState` in a registry
keyed by its session id (``session_state``): the taint list, the latest run's flags and kind,
``tainted_conversations``, ``search_exclude``, ``search_allow`` and the cached agent. A run's
context shares the session's taint list, so Hermes' learning pass, which runs on a daemon thread
after the run ended under the same session id, still finds the taint and the policy through
``session_state(session_id)``. Inside that pass ``current_run.get()`` answers ``None``: the fork
copied the finished run's context, and nothing in it may act for that run any more (end the turn,
ask Go about a tool, flush its stream).
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


RUN_KINDS = ("chat", "bot", "bot_review")
SESSIONS_MAX = 2048  # remembered sessions (oldest dropped first; Go resends taint in every run.start)


def _str_list(value: Any) -> list[str]:
    return [str(v) for v in value if isinstance(v, str) and v] if isinstance(value, (list, tuple)) else []


@dataclass
class SessionState:
    """What the learning policy needs about one conversation, beyond any single run."""
    session_id: str
    kind: str = "chat"
    flags: dict[str, Any] = field(default_factory=dict)
    tainted: list[Any] = field(default_factory=list)
    tainted_conversations: list[str] = field(default_factory=list)
    search_exclude: list[str] = field(default_factory=list)
    # The chats past-chat search may return (anything else is dropped).
    search_allow: Optional[list[str]] = None
    run_id: str = ""
    # The run whose learning pass is still running (``run_chat``): the pass's writes carry that
    # run's chip, though a later run of the chat may have started meanwhile.
    review_run_id: str = ""
    agent: Any = None
    # The agents whose learning pass still runs (the current one's, and a dropped one's after a
    # later turn took a fresh agent): learning.stop and session.delete cancel each.
    review_agents: list[Any] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def learning_writes(self) -> bool:
        return self.flags.get("learning_writes") is True

    @property
    def search_history(self) -> bool:
        return self.flags.get("search_history") is True and self.learning_writes

    @property
    def from_bot(self) -> bool:
        return self.flags.get("from_bot") is True

    def add_taint(self, sources: list[Any]) -> list[Any]:
        new = []
        with self.lock:
            seen = {_source_key(s) for s in self.tainted}
            for source in sources:
                key = _source_key(source)
                if key not in seen:
                    seen.add(key)
                    self.tainted.append(source)
                    new.append(source)
        return new

    def taint_snapshot(self) -> list[Any]:
        with self.lock:
            return list(self.tainted)


_sessions: dict[str, SessionState] = {}
_sessions_lock = threading.Lock()


def session_state(session_id: str | None) -> Optional[SessionState]:
    """The conversation's state, or None when no run of it was seen by this worker."""
    if not session_id:
        return None
    with _sessions_lock:
        return _sessions.get(str(session_id))


def bind_session(session_id: str, *, kind: str = "chat", flags: dict | None = None,
                 tainted_sources: list | None = None,
                 tainted_conversations: Any = None, search_exclude: Any = None, run_id: str = "",
                 search_allow: Any = None) -> SessionState:
    """Create or refresh the state at a run's start: the run's flags and lists replace the
    previous ones, the taint only grows (``tainted_sources`` from ``run.start`` merged in)."""
    with _sessions_lock:
        state = _sessions.pop(session_id, None) or SessionState(session_id=session_id)
        _sessions[session_id] = state  # most recently used last
        while len(_sessions) > SESSIONS_MAX:
            _sessions.pop(next(iter(_sessions)))
    state.kind = kind if kind in RUN_KINDS else "chat"
    state.flags = dict(flags or {})
    state.tainted_conversations = _str_list(tainted_conversations)
    state.search_exclude = _str_list(search_exclude)
    # No list (an older Go) allows no hit: a session Go does not know (restored, deleted) is dropped.
    state.search_allow = _str_list(search_allow)
    state.run_id = run_id
    state.add_taint([s for s in (tainted_sources or []) if isinstance(s, (dict, str))])
    return state


def stop_learning(session_id: str = "") -> list[SessionState]:
    """Turn learning off now for one conversation (``session_id``) or for every one this worker
    knows: the person chose "Don't learn from this chat" or turned learning off while a run or its
    learning pass may still write. Both read ``state.flags`` at each write, so later writes are
    blocked; the next ``run.start`` sets the flags afresh."""
    with _sessions_lock:
        states = [_sessions.get(session_id)] if session_id else list(_sessions.values())
    out = []
    for state in states:
        if state is None:
            continue
        flags = dict(state.flags)
        flags["learning_writes"] = False
        state.flags = flags
        out.append(state)
    return out


def stop_search(session_id: str = "") -> list[SessionState]:
    """Turn past-chat search off now for one conversation (``session_id``) or every one: the
    person turned "Search my past chats" off while a run or its learning pass may still search.
    ``timely_learning`` reads ``state.search_history`` at each ``session_search``."""
    with _sessions_lock:
        states = [_sessions.get(session_id)] if session_id else list(_sessions.values())
    out = []
    for state in states:
        if state is None:
            continue
        flags = dict(state.flags)
        flags["search_history"] = False
        state.flags = flags
        out.append(state)
    return out


def forget_session(session_id: str) -> None:
    with _sessions_lock:
        _sessions.pop(session_id, None)


@dataclass
class RunContext:
    run_id: str
    session_key: str
    conversation_id: str
    kind: str = "chat"  # "chat" | "bot" | "bot_review"
    tainted_sources: list[dict[str, Any]] = field(default_factory=list)
    pre_approved: Optional[dict[str, Any]] = None
    # run.start.permission: stored, not acted on in phase 2 (Go applies it to proposals).
    permission: str = "supervised"
    flags: dict[str, Any] = field(default_factory=dict)
    # The live AIAgent (set by run_chat once built), so a hook can end the turn.
    agent: Any = None
    # Flushes coalesced stream text before a Timely tool call goes to Go.
    flush: Optional[Callable[[], None]] = None
    # The run's event sink (``event`` lines to Go), for hooks that report (tool.output_risk).
    emit: Optional[Callable[[str, dict], None]] = None
    # Q-2.4: Go answered a recorded propose_changes with end_turn; the next tool call ends the turn.
    end_turn: bool = False
    end_turn_hit: bool = False
    # Whether the person stopped this run (run_chat sets it): an end_turn is then a Stop too.
    stopped: Callable[[], bool] = field(default=lambda: False, repr=False, compare=False)
    _batches: dict[str, Batch] = field(default_factory=dict, repr=False)
    _last_batch: Optional[Batch] = field(default=None, repr=False)
    _last_call: dict[str, str] = field(default_factory=dict, repr=False)
    # The Timely tool calls Go answered ``outside: true`` whose result has not reached the model
    # yet (``timely_tools`` wraps each as untrusted data in ``transform_tool_result``).
    _outside: set[str] = field(default_factory=set, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)
    # The conversation's state (phase 3): the run shares its taint list, so the learning pass
    # that outlives the run sees every source the run added.
    session: Optional[SessionState] = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.session is not None:
            self.session.add_taint(list(self.tainted_sources))
            self.tainted_sources = self.session.tainted
            self._lock = self.session.lock

    @property
    def learning_writes(self) -> bool:
        """``flags.learning_writes`` is exactly true (Go: account learning on, not Sensitive, not
        "Don't learn from this chat", not answer-only)."""
        return self.flags.get("learning_writes") is True

    @property
    def tainted(self) -> list[Any]:
        return self.taint_snapshot()

    @property
    def tainted_conversations(self) -> list[str]:
        return list(self.session.tainted_conversations) if self.session else []

    @property
    def search_exclude(self) -> list[str]:
        return list(self.session.search_exclude) if self.session else []

    def tool_call(self, name: str, args: dict | None = None,
                  timeout: float | None = None) -> tuple[Any, bool]:
        """Ask Go to run ``name`` for this run (``tool.call``); returns ``(result, outside)``.
        Used by backends that run inside Go (``timely_web``'s ``web_search``/``web_extract``).
        An outside result adds ``{kind, tool}`` to the taint. No answer raises ``TimeoutError``."""
        if ask is None:
            raise TimeoutError("no Go connection")
        call_id = ""
        try:
            from tools.approval_context import _approval_tool_call_id
            call_id = str(_approval_tool_call_id.get() or "")
        except Exception:
            pass
        if self.flush is not None:
            try:
                self.flush()
            except Exception:
                pass
        reply = ask({"type": "tool.call", "run": self.run_id, "session_key": self.session_key,
                     "tool_call_id": call_id, "name": name, "args": dict(args or {}),
                     "tainted_sources": self.taint_snapshot(), "batch_size": 1, "sibling_tools": []},
                    timeout if timeout is not None else TOOL_ANSWER_TIMEOUT_S)
        if not reply or reply.get("type") != "tool.result":
            raise TimeoutError(f"Timely did not answer {name}")
        outside = reply.get("outside") is True
        if outside:
            from timely_agent import policy
            report_taint(self, [{"kind": policy.taint_kind(name) or "timely", "tool": name}])
        return reply.get("result"), outside

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

    def note_outside(self, tool_call_id: str, tool_name: str) -> None:
        """Go answered this Timely tool call ``outside: true`` (its result quotes outside text)."""
        with self._lock:
            self._outside.add(tool_call_id or f"tool:{tool_name}")

    def take_outside(self, tool_call_id: str, tool_name: str) -> bool:
        """Whether that call's result quotes outside text (forgotten once asked). A call whose id
        the handler did not know is matched by its tool name."""
        with self._lock:
            for key in (tool_call_id, f"tool:{tool_name}"):
                if key and key in self._outside:
                    self._outside.discard(key)
                    return True
            return False

    # ------------------------------------------------------------ taint
    def add_taint(self, sources: list[Any]) -> list[Any]:
        """Append the sources not seen yet (append-only, deduplicated by canonical JSON); returns
        the new ones."""
        if self.session is not None:
            return self.session.add_taint(sources)
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


def in_review_fork() -> bool:
    """True inside Hermes' learning pass (the background review fork), whose turn binds the
    ``background_review`` write origin. Never imports Hermes: outside a worker it is False."""
    import sys
    prov = sys.modules.get("tools.skill_provenance")
    if prov is None:
        return False
    try:
        return bool(prov.is_background_review())
    except Exception:
        return False


class _CurrentRun:
    """``current_run``: the run of this thread's context. ``get()`` is None inside the learning
    pass: the fork's thread copied the context of the run that spawned it, after which that run
    may already be over, so a hook there must use ``session_state(session_id)`` instead."""

    def __init__(self) -> None:
        self._var: contextvars.ContextVar[Optional[RunContext]] = contextvars.ContextVar("timely_run", default=None)

    def get(self) -> Optional[RunContext]:
        run = self._var.get()
        if run is not None and in_review_fork():
            return None
        return run

    def set(self, value: Optional[RunContext]) -> contextvars.Token:
        return self._var.set(value)

    def reset(self, token: contextvars.Token) -> None:
        self._var.reset(token)


current_run = _CurrentRun()


def spawning_run() -> Optional[RunContext]:
    """Inside the learning pass: the run that spawned it (the context the fork's thread copied),
    for naming the pass's writes after it. Nothing in it may act for that run any more."""
    return current_run._var.get()


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

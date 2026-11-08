"""One chat turn on the vendored Hermes agent loop (plan section 3.4 steps 4-6 and 9).

Phase 1 runs a turn end to end against any OpenAI-compatible endpoint (the tests use a stub
model): build or reuse the conversation's ``AIAgent``, run ``run_conversation``, forward
callbacks as ``event`` messages and answer with ``run.done``. Timely tools, the Timely system
block decision (contract test 6), learning and approvals arrive in later phases.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from timely_agent import bridge

logger = logging.getLogger("timely_agent.run_chat")

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
              "reasoning_tokens", "total_tokens")
DEFAULT_MAX_ITERATIONS = 30
AGENT_CACHE_MAX = 16


@dataclass
class Run:
    run_id: str
    request_id: Optional[str]
    msg: dict[str, Any]
    thread: Optional[threading.Thread] = None
    agent: Any = None
    stop_reason: Optional[str] = None
    started: float = field(default_factory=time.monotonic)


def config_signature(msg: dict[str, Any]) -> str:
    """Agent cache key part: model, provider, toolsets and the Timely block hash (section 3.3)."""
    model = msg.get("model") or {}
    sig = {
        "provider": model.get("provider"), "model": model.get("model"), "base_url": model.get("base_url"),
        "api_mode": model.get("api_mode"), "reasoning": model.get("reasoning"),
        "toolsets": sorted(msg.get("toolsets") or []), "system": msg.get("system_hash") or "",
    }
    return hashlib.sha256(json.dumps(sig, sort_keys=True, default=str).encode()).hexdigest()[:16]


class AgentCache:
    """One ``AIAgent`` per conversation, rebuilt when the signature changes (LRU, bounded)."""

    def __init__(self, limit: int = AGENT_CACHE_MAX):
        self._lock = threading.Lock()
        self._items: dict[str, tuple[str, Any]] = {}
        self.limit = limit

    def get(self, conversation: str, signature: str) -> Any:
        with self._lock:
            item = self._items.pop(conversation, None)
            if item and item[0] == signature:
                self._items[conversation] = item
                return item[1]
            return None

    def put(self, conversation: str, signature: str, agent: Any) -> None:
        with self._lock:
            self._items.pop(conversation, None)
            self._items[conversation] = (signature, agent)
            while len(self._items) > self.limit:
                self._items.pop(next(iter(self._items)))

    def drop(self, conversation: str) -> None:
        with self._lock:
            self._items.pop(conversation, None)


def _short(value: Any, limit: int = 4000) -> Any:
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    try:
        text = json.dumps(value, default=str)
    except (TypeError, ValueError):
        text = str(value)
    return value if len(text) <= limit else text[:limit] + "…"


class EmitRef:
    """The current run's event sink. A cached agent outlives its first run, so its callbacks
    look the sink up per call instead of closing over one run's ``emit``."""

    def __init__(self) -> None:
        self.emit: Optional[Callable[[str, dict], None]] = None

    def __call__(self, kind: str, payload: dict) -> None:
        if self.emit is not None:
            self.emit(kind, payload)


def build_agent(msg: dict[str, Any], emit: EmitRef):
    """Construct the ``AIAgent`` for a run (section 3.4 step 5)."""
    from hermes_state import SessionDB
    from run_agent import AIAgent

    model = msg.get("model") or {}
    budgets = msg.get("budgets") or {}
    toolsets = [str(t) for t in msg.get("toolsets") or []]

    def delta(text=None, *_, **__):
        if text:
            emit("delta", {"text": str(text)})

    def tool_start(call_id=None, name=None, args=None, *_, **__):
        emit("tool.started", {"tool_call_id": call_id, "tool": name, "args": _short(args)})

    def tool_complete(call_id=None, name=None, args=None, result=None, *_, **__):
        emit("tool.completed", {"tool_call_id": call_id, "tool": name, "result": _short(result)})

    def reasoning(text=None, *_, **__):
        if text:
            emit("reasoning", {"text": str(text)})

    def status(kind=None, message=None, *_, **__):
        emit("status", {"kind": str(kind or ""), "message": str(message or "")})

    reasoning_cfg = model.get("reasoning")
    return AIAgent(
        base_url=model.get("base_url") or None,
        api_key=model.get("api_key") or None,
        provider=model.get("provider") or None,
        api_mode=model.get("api_mode") or None,
        model=model.get("model") or "",
        max_iterations=int(budgets.get("max_iterations") or DEFAULT_MAX_ITERATIONS),
        enabled_toolsets=toolsets,  # explicit, never None (section 8.1)
        quiet_mode=True,
        platform="timely",
        session_id=msg.get("conversation_id"),
        session_db=SessionDB(),
        load_soul_identity=True,
        skip_context_files=True,
        skip_memory=True,  # memory and learning writes stay off until phase 3
        skip_background_review=True,
        reasoning_config=reasoning_cfg if isinstance(reasoning_cfg, dict) else None,
        stream_delta_callback=delta,
        tool_start_callback=tool_start,
        tool_complete_callback=tool_complete,
        reasoning_callback=reasoning,
        status_callback=status,
    )


def _session_tokens(agent) -> dict[str, int]:
    out = {}
    for key in TOKEN_KEYS:
        value = getattr(agent, f"session_{key}", 0)
        out[key] = int(value) if isinstance(value, (int, float)) else 0
    return out


def run_turn(run: Run, cache: AgentCache, emit: Callable[[str, dict], None]) -> dict[str, Any]:
    """Run one turn; returns the ``run.done`` fields (never raises)."""
    from gateway.session_context import clear_session_vars, set_session_vars
    from tools.approval_context import reset_current_session_key, set_current_session_key

    msg = run.msg
    conversation = str(msg.get("conversation_id") or "")
    session_key = str(msg.get("session_key") or f"timely:{conversation}")
    ctx = bridge.RunContext(
        run_id=run.run_id, session_key=session_key, conversation_id=conversation, kind="chat",
        tainted_sources=list(msg.get("tainted_sources") or []), pre_approved=msg.get("pre_approved") or None)
    bridge.current_run.set(ctx)
    done: dict[str, Any] = {"final_response": "", "completed": False, "interrupted": False,
                            "turn_exit_reason": "", "tokens": {}, "estimated_cost_usd": None,
                            "turn_id": None, "tainted_sources": ctx.tainted_sources}
    key_token = set_current_session_key(session_key)
    var_tokens = set_session_vars(platform="timely", session_key=session_key, session_id=conversation,
                                  chat_id=conversation)
    try:
        signature = config_signature(msg)
        agent = cache.get(conversation, signature)
        if agent is None:
            ref = EmitRef()
            agent = build_agent(msg, ref)
            agent._timely_emit = ref
            cache.put(conversation, signature, agent)
        agent._timely_emit.emit = emit
        run.agent = agent
        if run.stop_reason:
            done.update(interrupted=True, turn_exit_reason="interrupted")
            return done
        before = _session_tokens(agent)
        cost_before = getattr(agent, "session_estimated_cost_usd", None)
        history = msg.get("history")
        kwargs: dict[str, Any] = {"task_id": conversation}
        if msg.get("system_text"):
            kwargs["system_message"] = str(msg["system_text"])
        if isinstance(history, list) and history:
            kwargs["conversation_history"] = history
        else:
            try:
                db = agent._session_db if hasattr(agent, "_session_db") else None
                if db is not None and conversation:
                    kwargs["conversation_history"] = db.get_messages_as_conversation(conversation)
            except Exception as exc:
                logger.debug("history load failed for %s: %s", conversation, exc)
        result = agent.run_conversation(str(msg.get("user_message") or ""), **kwargs) or {}
        after = _session_tokens(agent)
        cost_after = result.get("estimated_cost_usd", getattr(agent, "session_estimated_cost_usd", None))
        done.update(
            final_response=result.get("final_response") or "",
            completed=bool(result.get("completed")),
            interrupted=bool(result.get("interrupted")) or bool(run.stop_reason),
            turn_exit_reason=str(result.get("turn_exit_reason") or ""),
            tokens={k: max(0, after[k] - before[k]) for k in TOKEN_KEYS},
            turn_id=result.get("turn_id"),
            tainted_sources=ctx.tainted_sources,
        )
        if isinstance(cost_after, (int, float)):
            base = cost_before if isinstance(cost_before, (int, float)) else 0.0
            done["estimated_cost_usd"] = max(0.0, float(cost_after) - float(base))
        if result.get("failed") or result.get("error"):
            done["error"] = str(result.get("error") or "the turn failed")
    except Exception as exc:
        logger.exception("run %s failed", run.run_id)
        done["error"] = f"{type(exc).__name__}: {exc}"
        cache.drop(conversation)
    finally:
        if run.agent is not None and getattr(run.agent, "_timely_emit", None) is not None:
            run.agent._timely_emit.emit = None
        clear_session_vars(var_tokens)
        reset_current_session_key(key_token)
    return done

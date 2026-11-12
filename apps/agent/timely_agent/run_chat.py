"""One chat turn on the vendored Hermes agent loop (plan section 3.4 steps 4-6 and 9).

Build or reuse the conversation's ``AIAgent``, run ``run_conversation``, forward callbacks as
``event`` messages and answer with ``run.done``.

- **The Timely block** (``run.start.system_text``) goes in as the constructor's
  ``ephemeral_system_prompt`` (``SYSTEM_VIA``), chosen with contract test 6 (plan 5.3): Hermes
  appends it to the system prompt at API-call time, byte-identical every turn and after a rebuild
  from ``state.db``, and never stores it there, so a changed block (catalog, scope line) reaches
  the next turn. ``run_conversation(system_message=...)`` is baked into the prompt Hermes persists
  on the first turn and restored verbatim afterwards, so a changed block is ignored for the rest
  of the conversation. Evidence: ``timely_agent/README.md``.
- **No Timely turn cap** (Q-2.3): ``budgets.max_iterations`` only when Go sends one; otherwise
  Hermes' own ``agent.max_turns`` from config (``resolve_turn_limit``; unlimited by default).
- **Streaming** (Q-2.5): ``delta`` events are coalesced to at most one per 50 ms or 200
  characters (``DeltaCoalescer``), never dropping text, flushed before any other event, before a
  Timely ``tool.call`` and before ``run.done``.
- **End of turn after a proposal** (Q-2.4): when ``timely_gate`` ended the turn on a tool call
  after ``end_turn``, ``run.done`` says ``turn_exit_reason: "end_turn"``, ``interrupted: false``.
- **Learning** (phase 3, plan 9b): ``flags.learning_writes`` builds the agent with memory and the
  learning pass on (``skip_memory`` / ``skip_background_review`` are its negation). The review
  counters survive the agent cache and worker restarts (``learning.counters``). After the turn the
  feed reports what changed before ``run.done``; a learning pass Hermes started is watched
  (``busy.learning``) and reported when it ends. The pass uses the run's own model and
  credentials: Timely never sets ``auxiliary.background_review`` (Q-3.2).
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from timely_agent import bridge, config_render, policy
from timely_agent.learning import feed as learning_feed
from timely_agent.learning import passes as learning_passes

logger = logging.getLogger("timely_agent.run_chat")

TOKEN_KEYS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
              "reasoning_tokens", "total_tokens")
AGENT_CACHE_MAX = 16
# Where the Timely block goes (contract test 6): "ephemeral" = AIAgent(ephemeral_system_prompt=...),
# "system_message" = run_conversation(system_message=...). The contract test flips it through
# probe_boot to prove the choice.
SYSTEM_VIA = "ephemeral"
DELTA_INTERVAL_S = 0.05
DELTA_MAX_CHARS = 200
END_TURN_EXIT = "end_turn"


class DeltaCoalescer:
    """Coalesces streamed reply text: at most one ``delta`` per ``interval`` seconds, or sooner
    once ``max_chars`` characters wait. Text is never dropped or reordered: pending text goes out
    when the interval has passed (a timer covers a stream that pauses), before any other event
    (``emit`` for another kind) and on ``flush``/``close``."""

    def __init__(self, emit: Callable[[str, dict], None], interval: float = DELTA_INTERVAL_S,
                 max_chars: int = DELTA_MAX_CHARS, clock: Callable[[], float] = time.monotonic):
        self._emit, self.interval, self.max_chars, self._clock = emit, interval, max_chars, clock
        self._lock = threading.RLock()
        self._buf: list[str] = []
        self._size = 0
        self._last = float("-inf")
        self._timer: Optional[threading.Timer] = None
        self._closed = False

    def push(self, text: str) -> None:
        if not text:
            return
        with self._lock:
            self._buf.append(text)
            self._size += len(text)
            now = self._clock()
            if self._size >= self.max_chars or now - self._last >= self.interval:
                self._send_locked(now)
            elif self._timer is None and not self._closed:
                wait = max(0.0, self.interval - (now - self._last))
                self._timer = threading.Timer(wait, self._on_timer)
                self._timer.daemon = True
                self._timer.start()

    def _on_timer(self) -> None:
        with self._lock:
            self._timer = None
            if self._buf:
                self._send_locked(self._clock())

    def _send_locked(self, now: float) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if not self._buf:
            return
        text = "".join(self._buf)
        self._buf, self._size, self._last = [], 0, now
        self._emit("delta", {"text": text})

    def flush(self) -> None:
        with self._lock:
            self._send_locked(self._clock())

    def emit(self, kind: str, payload: dict) -> None:
        """The run's event sink: deltas are coalesced, anything else flushes them first."""
        if kind == "delta":
            self.push(str(payload.get("text") or ""))
            return
        with self._lock:
            self._send_locked(self._clock())
            self._emit(kind, payload)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._send_locked(self._clock())


def turn_limit(budgets: dict[str, Any] | None) -> int:
    """Q-2.3: ``budgets.max_iterations`` when Go sends a positive one (bots, later), else
    Hermes' own default: ``agent.max_turns`` from config through ``resolve_turn_limit``."""
    value = (budgets or {}).get("max_iterations")
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    from hermes_cli.config import load_config, resolve_turn_limit
    return resolve_turn_limit(((load_config() or {}).get("agent") or {}).get("max_turns"))


@dataclass
class Run:
    run_id: str
    request_id: Optional[str]
    msg: dict[str, Any]
    thread: Optional[threading.Thread] = None
    agent: Any = None
    stop_reason: Optional[str] = None
    started: float = field(default_factory=time.monotonic)
    # The cached agent outlives this run. ``finished`` (under ``lock``) marks the point after which
    # a stop or steer for this run must not reach it, or it would act on the conversation's next
    # turn: Hermes reads a leftover interrupt as "stopped before this turn started".
    finished: bool = False
    # ``learning.stop`` for this run's conversation (or every one) arrived after its run.start:
    # the run's flags came from Go before the person's switch, so its writes stay off whenever
    # the run binds its session state (``run_turn``).
    learning_stopped: bool = False
    # The same for "Search my past chats" turned off (``learning.stop`` with ``search_only``).
    search_stopped: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def attach(self, agent: Any) -> None:
        with self.lock:
            self.agent = agent

    def stop(self, reason: str) -> None:
        """Record the stop and interrupt the agent while this run still owns it."""
        with self.lock:
            self.stop_reason = reason
            if self.agent is None or self.finished:
                return
            try:
                self.agent.interrupt(reason, hard_cancel=True)
            except TypeError:
                self.agent.interrupt(reason)

    def steer(self, text: str) -> bool:
        with self.lock:
            return bool(self.agent is not None and not self.finished and self.agent.steer(text))

    def finish(self) -> None:
        """End this run's hold on the agent. A stop that landed after Hermes' turn finalizer
        cleared its interrupt (or before the turn started) is cleared here, so the next turn on
        this conversation starts clean."""
        with self.lock:
            self.finished = True
            if self.agent is None or not self.stop_reason:
                return
            try:
                self.agent.clear_interrupt(hard_cancel=True)
            except TypeError:
                self.agent.clear_interrupt()


def config_signature(msg: dict[str, Any]) -> str:
    """Agent cache key part: model, provider, key, toolsets and the Timely block hash (section 3.3).
    The key enters only as a hash: a key changed in Settings must reach the next turn."""
    model = msg.get("model") or {}
    sig = {
        "provider": model.get("provider"), "model": model.get("model"), "base_url": model.get("base_url"),
        "api_mode": model.get("api_mode"), "reasoning": model.get("reasoning"),
        "key": hashlib.sha256(str(model.get("api_key") or "").encode()).hexdigest(),
        "toolsets": sorted(msg.get("toolsets") or []), "system": msg.get("system_hash") or "",
        # the learning pass is a constructor choice (skip_background_review)
        "learning": (msg.get("flags") or {}).get("learning_writes") is True,
        # the block itself too: with ephemeral_system_prompt a changed block needs a new agent
        "system_text": hashlib.sha256(str(msg.get("system_text") or "").encode()).hexdigest(),
    }
    return hashlib.sha256(json.dumps(sig, sort_keys=True, default=str).encode()).hexdigest()[:16]


class AgentCache:
    """One ``AIAgent`` per conversation, rebuilt when the signature changes (LRU, bounded).

    An agent leaving the cache (LRU eviction, a changed signature, ``drop``) hands its review
    counters to ``counters`` first (plan 3.3), so the next agent of that conversation resumes them."""

    def __init__(self, limit: int = AGENT_CACHE_MAX, counters: Any = None):
        self._lock = threading.Lock()
        self._items: dict[str, tuple[str, Any]] = {}
        self.limit = limit
        self.counters = counters

    def _evicted(self, conversation: str, agent: Any) -> None:
        if self.counters is not None and agent is not None:
            self.counters.store(conversation, agent)

    def get(self, conversation: str, signature: str) -> Any:
        with self._lock:
            item = self._items.pop(conversation, None)
            if item and item[0] == signature:
                self._items[conversation] = item
                return item[1]
        if item:
            self._evicted(conversation, item[1])
        return None

    def put(self, conversation: str, signature: str, agent: Any) -> None:
        gone = []
        with self._lock:
            old = self._items.pop(conversation, None)
            if old is not None and old[1] is not agent:
                gone.append((conversation, old[1]))
            self._items[conversation] = (signature, agent)
            while len(self._items) > self.limit:
                key = next(iter(self._items))
                gone.append((key, self._items.pop(key)[1]))
        for key, old_agent in gone:
            self._evicted(key, old_agent)

    def drop(self, conversation: str, keep_counters: bool = True) -> None:
        with self._lock:
            item = self._items.pop(conversation, None)
        if item and keep_counters:
            self._evicted(conversation, item[1])

    def items(self) -> list[tuple[str, Any]]:
        with self._lock:
            return [(k, v[1]) for k, v in self._items.items()]

    def store_all(self) -> None:
        """Every cached agent's counters (worker shutdown)."""
        for conversation, agent in self.items():
            self._evicted(conversation, agent)


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
    toolsets = [str(t) for t in msg.get("toolsets") or []]
    learning = (msg.get("flags") or {}).get("learning_writes") is True

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
    system_text = str(msg.get("system_text") or "")
    return AIAgent(
        base_url=model.get("base_url") or None,
        api_key=model.get("api_key") or None,
        provider=model.get("provider") or None,
        api_mode=model.get("api_mode") or None,
        model=model.get("model") or "",
        max_iterations=turn_limit(msg.get("budgets")),
        enabled_toolsets=toolsets,  # explicit, never None (section 8.1)
        # The managed floor agent.disabled_toolsets: AIAgent does not read that key itself (Hermes'
        # CLI and gateway pass it in), so pass it here; subtracted last, after any composite.
        disabled_toolsets=list(config_render.NEVER_TOOLSETS),
        quiet_mode=True,
        platform="timely",
        session_id=msg.get("conversation_id"),
        session_db=SessionDB(),
        load_soul_identity=True,
        skip_context_files=True,
        # A chat always reads About you and Notes (plan 9b.3; review round 6): learning off, a
        # Sensitive or Don't-learn chat or an answer-only turn stops writes and the learning pass
        # only. Without the memory toolset the model has no memory tool, Hermes ticks no memory
        # review, and timely_learning blocks any write while learning_writes is not true (9b.2).
        skip_memory=False,
        skip_background_review=not learning,
        ephemeral_system_prompt=(system_text or None) if SYSTEM_VIA == "ephemeral" else None,
        reasoning_config=reasoning_cfg if isinstance(reasoning_cfg, dict) else None,
        stream_delta_callback=delta,
        tool_start_callback=tool_start,
        tool_complete_callback=tool_complete,
        reasoning_callback=reasoning,
        status_callback=status,
    )


SEED_ROLES = ("user", "assistant")


def _history(agent, conversation: str, seed: Any, reseed: bool = False) -> tuple[Optional[list], bool]:
    """``(conversation_history, seeded)``. ``state.db`` is the working transcript (plan 5.4): when
    it already holds messages for the session, they are the history and a ``run.start.history``
    seed is ignored. When it holds none and Go sent a seed (restore, new machine, deleted cache),
    the seed's user and assistant messages are written into ``state.db`` first, so every later
    turn keeps them (Hermes stores only a turn's new messages, never a caller's history).
    ``reseed`` (the chat had turns on classic since this session's last turn) replaces the stored
    messages with the seed; the replaced ones are soft-archived, as Hermes' rewind does."""
    db = getattr(agent, "_session_db", None)
    if db is None or not conversation:
        return (seed if isinstance(seed, list) and seed else None), False
    try:
        stored = db.get_messages_as_conversation(conversation) or []
    except Exception as exc:
        logger.debug("history load failed for %s: %s", conversation, exc)
        stored = []
    seed = seed if isinstance(seed, list) else []
    if not (seed or (stored and reseed)) or (stored and not reseed):
        return stored, False
    # Each seeded row carries a message_uid that names it as a seed (Hermes keeps the uid through
    # compaction and never sends it to a model): a seeded reply stands for turns whose Timely reads
    # the worker no longer holds, so the exfiltration rule counts it as the person's data.
    rows = [{"role": m["role"], "content": m["content"], "message_uid": policy.SEED_UID_PREFIX + uuid.uuid4().hex}
            for m in seed
            if isinstance(m, dict) and m.get("role") in SEED_ROLES and isinstance(m.get("content"), str)]
    try:
        db.ensure_session(conversation, source="timely", model=getattr(agent, "model", None))
        if stored:
            db.replace_messages(conversation, rows, archive_dropped=True)
        else:
            db.append_messages_batch(conversation, rows)
        return db.get_messages_as_conversation(conversation) or rows, True
    except Exception as exc:
        logger.warning("history seed for %s could not be stored, used for this turn only: %s", conversation, exc)
        return rows, True


def _closing_text(result: dict[str, Any]) -> str:
    """The closing sentence the model wrote after a recorded proposal: the last non-empty
    assistant text after the ``propose_changes`` call (Hermes appends an empty assistant row when
    the turn is interrupted), never Hermes' own interruption wording."""
    for message in reversed(result.get("messages") or []):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        names = [((c or {}).get("function") or {}).get("name") for c in message.get("tool_calls") or []
                 if isinstance(c, dict)]
        if "propose_changes" in names:
            return ""
    return ""


def _session_tokens(agent) -> dict[str, int]:
    out = {}
    for key in TOKEN_KEYS:
        value = getattr(agent, f"session_{key}", 0)
        out[key] = int(value) if isinstance(value, (int, float)) else 0
    return out


def _report_run(ctx: bridge.RunContext) -> None:
    """What the turn changed, as learning events, before ``run.done`` (never raises)."""
    feed = learning_feed.current()
    if feed is None:
        return
    try:
        origin = "bot" if ctx.flags.get("from_bot") is True or ctx.kind != "chat" else "chat"
        feed.diff(learning_feed.Context(origin=origin, conversation_id=ctx.conversation_id, run_id=ctx.run_id,
                                        tainted_sources=ctx.taint_snapshot()))
    except Exception:
        logger.exception("run %s: reporting learning changes failed", ctx.run_id)


def _report_pass(conversation: str) -> None:
    """What a learning pass changed (origin ``review``; ``bot`` for a bot's conversation)."""
    feed = learning_feed.current()
    if feed is None:
        return
    state = bridge.session_state(conversation)
    from_bot = state is not None and (state.from_bot or state.kind != "chat")
    feed.diff(learning_feed.Context(
        origin="bot" if from_bot else "review", conversation_id=conversation,
        run_id=state.run_id if state is not None else "",
        tainted_sources=state.taint_snapshot() if state is not None else []))


def _log_pass_usage(conversation: str, spent: dict[str, Any]) -> None:
    """A learning pass's tokens, apart from the turn's (plan 9b.8): Go writes ``log`` lines to the
    API log, as it logs each turn's tokens from ``run.done``. Nothing shows them in the apps yet."""
    if bridge.notify is None:
        return
    cost = spent.get("estimated_cost_usd")
    text = (f"learning pass for {conversation}: {spent.get('input_tokens', 0)} input, "
            f"{spent.get('output_tokens', 0)} output tokens in {spent.get('api_calls', 0)} call(s)"
            f" ({spent.get('model') or 'the chat model'}), cost {'unknown' if cost is None else f'${cost:.4f}'}")
    try:
        bridge.notify({"type": "log", "level": "info", "text": text})
    except Exception:
        logger.exception("logging a learning pass's tokens failed")


def _review_callback(conversation: str) -> Callable[[str], None]:
    """``AIAgent.background_review_callback``: Hermes calls it with the pass's summary once the
    fork's writes are done; the feed re-diffs then (the watcher re-diffs again when the pass ends)."""
    def callback(_summary: Any = None, *_: Any, **__: Any) -> None:
        try:
            _report_pass(conversation)
        except Exception:
            logger.exception("learning pass report for %s failed", conversation)
    return callback


def run_turn(run: Run, cache: AgentCache, emit: Callable[[str, dict], None]) -> dict[str, Any]:
    """Run one turn; returns the ``run.done`` fields (never raises)."""
    from gateway.session_context import clear_session_vars, set_session_vars
    from hermes_constants import get_hermes_home
    from tools.approval_context import reset_current_session_key, set_current_session_key
    from tools.terminal_scope import install_profile_terminal_scope, reset_terminal_scope

    msg = run.msg
    conversation = str(msg.get("conversation_id") or "")
    session_key = str(msg.get("session_key") or f"timely:{conversation}")
    done: dict[str, Any] = {"final_response": "", "completed": False, "interrupted": False,
                            "turn_exit_reason": "", "tokens": {}, "estimated_cost_usd": None,
                            "turn_id": None, "tainted_sources": [], "history_seeded": False,
                            "pending_steer": ""}
    key_token = var_tokens = scope_token = None
    sink = DeltaCoalescer(emit)
    flags = dict(msg.get("flags") or {})
    state = bridge.bind_session(
        conversation, kind="chat", flags=flags, tainted_sources=list(msg.get("tainted_sources") or []),
        person_hosts=msg.get("person_hosts"), tainted_conversations=msg.get("tainted_conversations"),
        search_exclude=msg.get("search_exclude"), run_id=run.run_id, search_allow=msg.get("search_allow"),
        private_context=msg.get("private_context"), person_links=msg.get("person_links"))
    if run.learning_stopped:  # after the bind: a stop that lands meanwhile reaches the state itself
        bridge.stop_learning(conversation)
    if run.search_stopped:
        bridge.stop_search(conversation)
    ctx = bridge.RunContext(
        run_id=run.run_id, session_key=session_key, conversation_id=conversation, kind="chat",
        tainted_sources=list(msg.get("tainted_sources") or []), pre_approved=msg.get("pre_approved") or None,
        permission=str(msg.get("permission") or "supervised"), flags=flags,
        flush=sink.flush, session=state)
    ctx.stopped = lambda: bool(run.stop_reason)
    counters = getattr(cache, "counters", None)
    turn_ran = False
    try:
        bridge.current_run.set(ctx)
        done["tainted_sources"] = ctx.taint_snapshot()
        key_token = set_current_session_key(session_key)
        var_tokens = set_session_vars(platform="timely", session_key=session_key, session_id=conversation,
                                      chat_id=conversation)
        # The account's complete TERMINAL_* policy (config.yaml + managed floors), as Hermes' gateway
        # binds it per turn: home_mode profile, cwd = the account workspace, local backend. Unresolvable
        # config installs Hermes' refusal scope, so terminal tools fail closed.
        scope_token = install_profile_terminal_scope(get_hermes_home())
        signature = config_signature(msg)
        agent = cache.get(conversation, signature)
        if agent is None:
            ref = EmitRef()
            agent = build_agent(msg, ref)
            agent._timely_emit = ref
            if counters is not None:
                counters.apply(conversation, agent)  # resume the review counters (plan 3.3)
            agent.background_review_callback = _review_callback(conversation)
            cache.put(conversation, signature, agent)
        agent._timely_emit.emit = sink.emit
        ctx.agent = agent
        state.agent = agent
        run.attach(agent)
        if run.stop_reason:
            done.update(interrupted=True, turn_exit_reason="interrupted")
            return done
        before = _session_tokens(agent)
        cost_before = getattr(agent, "session_estimated_cost_usd", None)
        kwargs: dict[str, Any] = {"task_id": conversation}
        if msg.get("system_text") and SYSTEM_VIA == "system_message":
            kwargs["system_message"] = str(msg["system_text"])
        stored, seeded = _history(agent, conversation, msg.get("history"), msg.get("reseed") is True)
        done["history_seeded"] = seeded
        if stored is not None:
            kwargs["conversation_history"] = stored
        turn_ran = True
        result = agent.run_conversation(str(msg.get("user_message") or ""), **kwargs) or {}
        # Hermes may have started the learning pass on a daemon thread: busy until it ends, then
        # report what it learned.
        learning_passes.watch(agent, lambda: _report_pass(conversation),
                              on_usage=lambda spent: _log_pass_usage(conversation, spent))
        after = _session_tokens(agent)
        cost_after = result.get("estimated_cost_usd", getattr(agent, "session_estimated_cost_usd", None))
        done.update(
            final_response=result.get("final_response") or "",
            completed=bool(result.get("completed")),
            interrupted=bool(result.get("interrupted")) or bool(run.stop_reason),
            turn_exit_reason=str(result.get("turn_exit_reason") or ""),
            tokens={k: max(0, after[k] - before[k]) for k in TOKEN_KEYS},
            turn_id=result.get("turn_id"),
            # A steer sent while the last reply streamed, which no tool batch took in: Go makes it
            # the person's next turn.
            pending_steer=str(result.get("pending_steer") or ""),
        )
        if ctx.end_turn_hit and not run.stop_reason:
            # timely_gate ended the turn on a tool call after a recorded proposal (Q-2.4): that is
            # the turn finishing, not a Stop. The interrupt it raised is cleared below.
            done.update(interrupted=False, completed=True, turn_exit_reason=END_TURN_EXIT,
                        final_response=_closing_text(result))
        if isinstance(cost_after, (int, float)):
            base = cost_before if isinstance(cost_before, (int, float)) else 0.0
            done["estimated_cost_usd"] = max(0.0, float(cost_after) - float(base))
        if result.get("failed") or result.get("error"):
            done["error"] = str(result.get("error") or "the turn failed")
    except Exception as exc:
        logger.exception("run %s failed", run.run_id)
        done["error"] = f"{type(exc).__name__}: {exc}"
        cache.drop(conversation)  # stores the counters first
    finally:
        done["tainted_sources"] = ctx.taint_snapshot()
        if turn_ran and counters is not None and run.agent is not None:
            counters.store(conversation, run.agent)  # after every turn (plan 3.3)
        try:
            sink.close()  # every delta before run.done
        except Exception:
            logger.exception("run %s: flushing stream text failed", run.run_id)
        _report_run(ctx)  # after the stream text, before run.done
        if ctx.end_turn_hit and run.agent is not None:
            try:
                run.agent.clear_interrupt()
            except Exception:
                logger.exception("run %s: clearing the end-of-turn interrupt failed", run.run_id)
                cache.drop(conversation)
        try:
            run.finish()
        except Exception:
            logger.exception("run %s: clearing a late stop failed", run.run_id)
            cache.drop(conversation)  # never reuse an agent that may still hold the stop
        if run.agent is not None and getattr(run.agent, "_timely_emit", None) is not None:
            run.agent._timely_emit.emit = None
        if scope_token is not None:
            reset_terminal_scope(scope_token)
        if var_tokens is not None:
            clear_session_vars(var_tokens)
        if key_token is not None:
            reset_current_session_key(key_token)
    return done

"""Host tools in the worker (phase 5, PROTOCOL.md section 12): the approval bridge, the live wait and
the parked card, Full Access, the dispatch fence, ``host.ran`` and checkpoint restore.

**The approval bridge** (``notifier``). Hermes calls the notifier ``worker.py`` registers per run for
every approval it raises on the run's session key, on the thread that waits for the answer:

- A Timely card (pattern key ``plugin_rule:timely:<call id>``, from a ``gate.verdict`` ``approve``)
  goes to Go as ``event approval.request`` with the call's ``tool_call_id``, ``tool``, ``args_hash``
  and ``live_wait_s``, and a timer starts. When the live wait ends before an answer, the request is
  withdrawn (the tool never runs; the model reads Hermes' BLOCKED text naming
  ``policy.PARKED_TEXT``), ``event approval.parked`` goes out, and the turn ends after this round
  (a soft interrupt): ``run.done {turn_exit_reason: "approval_parked", parked}`` (decision 2).
- Any other approval is Hermes' own (its terminal guard's dangerous-command prompt, the
  execute_code whole-script prompt, a protected-path write) for the call this thread executes.
  When Timely already let that call run (``RunContext.approved_calls``: Go's ``allow``, the
  person's Run once, a pre-approved continuation call), the worker answers it ``once`` and sends
  ``event approval.auto``: the person sees one card per call (decision 4). Otherwise it is denied
  and logged (fail closed).

**Full Access** (``flags.full_access`` with permission ``full``): ``enable_session_yolo`` for the
run's session, so Hermes raises no second prompt; Hermes' hardline floor (``_floor_block``) runs
before YOLO and still refuses ``rm -rf /``, ``mkfs`` and fork bombs. YOLO would also auto-approve
a plugin ``approve`` (``_run_approval_gate``), so the first ``approve`` verdict of the run turns
YOLO off for the rest of it (``suspend_yolo``): a card Go asks for is always a card.

**The dispatch fence** (runtime override R6, ``install_fence``): ``tools.registry.registry.dispatch``
is wrapped so a host or MCP tool never starts once the person stopped the run, also when Run once
arrived just before the Stop (Hermes runs the tool right after the approval resolves; no hook sits
between). The fence returns a block result; ``host.ran`` reports it ``blocked``.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from timely_agent import bridge, policy

logger = logging.getLogger("timely_agent.host")

TIMELY_RULE_PREFIX = "plugin_rule:timely:"
PARKED_REASON = "timely_approval_parked"


@dataclass
class HostRequest:
    """One Timely host card waiting in Hermes' approval gate."""
    request_id: str
    run: bridge.RunContext
    session_key: str
    call_id: str
    tool: str
    args_hash: str
    timer: Optional[threading.Timer] = None
    done: bool = False

    def info(self) -> dict[str, Any]:
        return {"request_id": self.request_id, "tool": self.tool, "args_hash": self.args_hash,
                "tool_call_id": self.call_id}


_requests: dict[str, HostRequest] = {}
_lock = threading.Lock()
_executing = threading.local()


# ---------------------------------------------------------------- which call this thread runs

def mark_executing(run: bridge.RunContext, call_id: str) -> None:
    """The gate let ``call_id`` through on this thread (allowed, or a card is about to be asked):
    Hermes' own approvals raised on this thread belong to it."""
    _executing.run_id = run.run_id
    _executing.call_id = call_id


def executing_call(run: bridge.RunContext) -> str:
    if getattr(_executing, "run_id", "") == run.run_id:
        return str(getattr(_executing, "call_id", "") or "")
    return ""


def context_call_id() -> str:
    """The call id Hermes' approval context holds for this thread ("" outside a tool call)."""
    try:
        from tools.approval_context import _approval_tool_call_id
        return str(_approval_tool_call_id.get() or "")
    except Exception:
        return ""


def timely_call_id(pattern_key: str) -> str:
    """The call id a Timely card's pattern key carries, else ""."""
    return pattern_key[len(TIMELY_RULE_PREFIX):] if pattern_key.startswith(TIMELY_RULE_PREFIX) else ""


def pending(run_id: str = "") -> list[HostRequest]:
    with _lock:
        return [r for r in _requests.values() if not r.done and (not run_id or r.run.run_id == run_id)]


def _scalars(data: dict) -> dict[str, Any]:
    return {k: v for k, v in data.items() if isinstance(v, (str, int, float, bool, type(None)))}


def _log(level: str, text: str) -> None:
    getattr(logger, "warning" if level == "warn" else level, logger.info)(text)
    if bridge.notify is not None:
        try:
            bridge.notify({"type": "log", "level": level, "text": text})
        except Exception:
            pass


# ---------------------------------------------------------------- the approval bridge

def notifier(run_of: Callable[[], Optional[bridge.RunContext]], emit: Callable[[str, dict], None],
             session_key: str) -> Callable[[dict], None]:
    """Hermes' gateway notify callback for one run (``register_gateway_notify``)."""

    def notify(data: dict) -> None:
        from tools.approval import resolve_gateway_approval
        request_id = str(data.get("request_id") or "")
        pattern_key = str(data.get("pattern_key") or "")
        run = run_of()
        call_id = timely_call_id(pattern_key)
        if run is None or not request_id:
            _log("warn", f"approval {pattern_key or '?'} raised outside a run: denied")
            if request_id:
                resolve_gateway_approval(session_key, "deny", request_id=request_id)
            return
        if call_id:
            _open_card(run, emit, session_key, request_id, call_id, data)
            return
        # the call Hermes is executing on this thread (its approval context), else the one the gate let
        # through on this thread last (an execute_code inner call has no id in the context)
        current = context_call_id() or executing_call(run)
        if current and run.is_approved(current):
            n = resolve_gateway_approval(session_key, "once", request_id=request_id)
            logger.info("run %s: Hermes' approval %s for approved call %s answered once (%d)",
                        run.run_id, pattern_key, current, n)
            emit("approval.auto", {"request_id": request_id, "tool_call_id": current, "pattern_key": pattern_key})
            return
        resolve_gateway_approval(session_key, "deny", request_id=request_id)
        _log("warn", f"run {run.run_id}: {policy.UNMATCHED_APPROVAL} ({pattern_key}, call {current or '?'}): denied")

    return notify


def _open_card(run: bridge.RunContext, emit: Callable[[str, dict], None], session_key: str,
               request_id: str, call_id: str, data: dict) -> None:
    info = run.asked_for(call_id) or {}
    req = HostRequest(request_id=request_id, run=run, session_key=session_key, call_id=call_id,
                      tool=str(info.get("tool") or ""), args_hash=str(info.get("args_hash") or ""))
    wait = max(0.0, float(run.host_live_wait_s))
    payload = _scalars(data)
    payload.update(tool_call_id=call_id, tool=req.tool, args_hash=req.args_hash, live_wait_s=int(round(wait)))
    with _lock:
        _requests[request_id] = req
    try:
        from tools.approval import observe_gateway_settle
        observe_gateway_settle(session_key, request_id, lambda _reason, r=req: _settled(r))
    except Exception as exc:  # the timer still parks; settle only tidies up
        logger.debug("observe_gateway_settle failed: %s", exc)
    emit("approval.request", payload)
    timer = threading.Timer(wait, park, args=(req,))
    timer.daemon = True
    req.timer = timer
    if not req.done:
        timer.start()


def _settled(req: HostRequest) -> None:
    """The wait ended (any way): stop the live timer and forget the request."""
    with _lock:
        req.done = True
        _requests.pop(req.request_id, None)
    if req.timer is not None:
        req.timer.cancel()


def park(req: HostRequest, end_turn: bool = True) -> bool:
    """End a live wait unanswered: withdraw the request (the tool never runs), report it parked
    and, with ``end_turn``, end the turn after this round. False when it was already answered."""
    from tools.approval import withdraw_gateway_approval
    with _lock:
        if req.done:
            return False
    if not withdraw_gateway_approval(req.session_key, req.request_id, policy.PARKED_TEXT):
        return False
    _settled(req)
    run = req.run
    info = req.info()
    with run._lock:
        if run.parked is None:
            run.parked = dict(info)
        run.parked_all.append(dict(info))
    if run.emit is not None:
        try:
            run.emit("approval.parked", dict(info))
        except Exception:
            logger.exception("sending approval.parked failed")
    for other in pending(run.run_id):  # the same turn ends: every other live card parks with it
        park(other, end_turn=False)
    if end_turn and run.agent is not None and not run.stopping:
        try:
            run.agent.interrupt(None, tool_reason=PARKED_REASON)
        except TypeError:
            run.agent.interrupt(None)
        except Exception as exc:
            logger.warning("ending the turn after a parked card failed: %s", exc)
    return True


def park_pending(run: bridge.RunContext) -> int:
    """Shutdown: every live card of the run parks now (nothing ran; Go keeps the card)."""
    reqs = pending(run.run_id)
    parked = 0
    for i, req in enumerate(reqs):
        parked += bool(park(req, end_turn=(i == len(reqs) - 1)))
    return parked


def deny_pending(run: bridge.RunContext, session_key: str) -> int:
    """Stop: deny every approval the run waits on, before the run is interrupted."""
    from tools.approval import resolve_gateway_approval
    n = 0
    for req in pending(run.run_id):
        n += resolve_gateway_approval(req.session_key, "deny", request_id=req.request_id)
        _settled(req)
    n += resolve_gateway_approval(session_key, "deny", resolve_all=True)
    return n


def answer(run: bridge.RunContext, session_key: str, request_id: str, choice: str) -> bool:
    """``approval.answer``: resolve a Timely card. False when it no longer waits, belongs to
    another run, or the run was stopped before Run once arrived (then it is denied)."""
    from tools.approval import resolve_gateway_approval
    with _lock:
        req = _requests.get(request_id)
    if req is None or req.done or req.run is not run:
        return False
    if choice == "once" and run.stopping:
        resolve_gateway_approval(session_key, "deny", request_id=request_id)
        _settled(req)
        return False
    if choice == "once":
        # before resolving: Hermes' second approval for this call may follow at once
        run.approve_call(req.call_id, req.args_hash)
    n = resolve_gateway_approval(session_key, choice, request_id=request_id)
    if n == 0 and choice == "once":
        with run._lock:
            run.approved_calls.pop(req.call_id, None)
    if n:
        _settled(req)
    return n > 0


def forget_run(run: bridge.RunContext) -> None:
    for req in pending(run.run_id):
        _settled(req)


# ---------------------------------------------------------------- Full Access (YOLO)

def start_yolo(run: bridge.RunContext) -> None:
    if not run.full_access:
        return
    from tools.approval import enable_session_yolo
    enable_session_yolo(run.session_key)
    run.yolo = True


def suspend_yolo(run: bridge.RunContext) -> None:
    """A card Go asked for must reach the person even in Full Access (YOLO would approve it)."""
    if not run.yolo:
        return
    from tools.approval import disable_session_yolo
    disable_session_yolo(run.session_key)
    run.yolo = False
    logger.info("run %s: Full Access YOLO off for the rest of the run (Timely asked for a card)", run.run_id)


def end_yolo(run: bridge.RunContext) -> None:
    if not run.full_access:
        return
    try:
        from tools.approval import disable_session_yolo
        disable_session_yolo(run.session_key)
    except Exception:
        logger.exception("run %s: turning YOLO off failed", run.run_id)
    run.yolo = False


# ---------------------------------------------------------------- dispatch fence (runtime override R6)

_FENCE_MARK = "_timely_fence"
# Test hook (tests/exec_trap.py --slow-fence): seconds the fence waits before it checks the stop.
FENCE_DELAY_S = 0.0


def install_fence() -> None:
    from tools.registry import registry
    current = registry.dispatch
    if getattr(current, _FENCE_MARK, False):
        return
    original = current

    def dispatch(name: str, args: dict, *a: Any, **kw: Any):
        run = bridge.current_run.get()
        if run is not None and (policy.is_host_call(name, args if isinstance(args, dict) else {})
                                or policy.is_mcp_tool(name)):
            if FENCE_DELAY_S:
                time.sleep(FENCE_DELAY_S)
            if run.stopping:
                cid = context_call_id() or name
                with run._lock:
                    run.fence_blocked.add(cid)
                logger.info("run %s: %s not started, the run was stopped", run.run_id, name)
                return json.dumps({"error": policy.STOPPED})
        return original(name, args, *a, **kw)

    setattr(dispatch, _FENCE_MARK, True)
    dispatch.__wrapped__ = original  # type: ignore[attr-defined]
    registry.dispatch = dispatch  # instance attribute: every caller looks it up at call time


def fence_active() -> bool:
    try:
        from tools.registry import registry
        return bool(getattr(registry.dispatch, _FENCE_MARK, False))
    except Exception:
        return False


# ---------------------------------------------------------------- host.ran and checkpoints

def _checkpoint_dir(agent: Any, tool: str, args: dict) -> str:
    try:
        if tool in ("write_file", "patch") and args.get("path"):
            from tools.file_tools_paths import _resolve_path_for_task
            path = _resolve_path_for_task(str(args["path"]), "default")
            return str(agent._checkpoint_mgr.get_working_dir_for_path(str(path)))
        if tool == "terminal":
            from agent.runtime_cwd import scope_terminal_cwd
            return str(args.get("workdir") or scope_terminal_cwd() or "")
    except Exception as exc:
        logger.debug("checkpoint folder for %s: %s", tool, exc)
    return ""


def checkpoint_for(run: bridge.RunContext, tool: str, args: dict) -> tuple[str, str]:
    """``(checkpoint id, folder)`` Hermes took before this call in this run, else ``("", "")``."""
    agent = run.agent
    mgr = getattr(agent, "_checkpoint_mgr", None)
    if mgr is None or not getattr(mgr, "enabled", False) or tool not in policy.CHECKPOINT_TOOLS:
        return "", ""
    folder = _checkpoint_dir(agent, tool, args)
    if not folder:
        return "", ""
    try:
        from datetime import datetime
        for entry in mgr.list_checkpoints(folder):
            stamp = datetime.fromisoformat(str(entry.get("timestamp"))).timestamp()
            if stamp >= run.started_at - 2:
                return str(entry.get("hash") or ""), folder
            break
    except Exception as exc:
        logger.debug("listing checkpoints for %s: %s", folder, exc)
    return "", ""


def report_ran(run: bridge.RunContext, tool: str, args: dict, call_id: str, status: Optional[str]) -> None:
    """``event host.ran`` once a host or MCP call finished (any status)."""
    if run.emit is None:
        return
    with run._lock:
        fenced = call_id in run.fence_blocked or tool in run.fence_blocked
    state = "blocked" if fenced or status == "blocked" else "error" if status == "error" else "ok"
    if state == "error" and run.stopping:
        state = "interrupted"
    payload: dict[str, Any] = {"tool_call_id": call_id, "tool": tool, "args_hash": policy.args_hash(args),
                               "status": state}
    if state == "ok":
        checkpoint, folder = checkpoint_for(run, tool, args)
        if checkpoint:
            payload["checkpoint"] = checkpoint
            payload["checkpoint_dir"] = folder
    try:
        run.emit("host.ran", payload)
    except Exception:
        logger.exception("sending host.ran failed")


def restore_checkpoint(checkpoint: str, working_dir: str) -> dict[str, Any]:
    """``checkpoint.restore``: put ``working_dir`` back to Hermes' checkpoint (a safe restore:
    files the person edited since Hermes wrote them stay). Returns ``checkpoint.result`` fields."""
    from tools.checkpoint_manager import CheckpointManager
    if not checkpoint or not working_dir or not Path(working_dir).is_absolute():
        return {"ok": False, "restored": [], "error": "checkpoint and an absolute working_dir are needed"}
    mgr = CheckpointManager(enabled=True)
    known = [c.get("hash") for c in mgr.list_checkpoints(working_dir)]
    if checkpoint not in known:
        return {"ok": False, "restored": [], "error": "that checkpoint is gone"}
    result = mgr.restore(working_dir, checkpoint, safe=True)
    if not result.get("success"):
        return {"ok": False, "restored": [], "error": str(result.get("error") or "restore failed")}
    restored = result.get("restored_files")
    if restored is None:  # a full restore (no agent-write ledger yet) names no files
        restored = ["."]
    out: dict[str, Any] = {"ok": True, "restored": [str(p) for p in restored] if isinstance(restored, list) else []}
    skipped = result.get("skipped_user_edits")
    if skipped:
        out["skipped"] = [str(p) for p in skipped]
    return out


# ---------------------------------------------------------------- context files (decision 10)

def context_file_taint(agent: Any) -> list[dict[str, Any]]:
    """The project context files Hermes loaded into this agent's prompt (a chosen working folder
    only): outside content, so each is a taint source ``{kind: "file", tool: "context_file", path}``."""
    if agent is None or getattr(agent, "skip_context_files", True):
        return []
    try:
        from agent.context_file_sources import context_file_sources_for_agent
        sources = context_file_sources_for_agent(agent)
    except Exception as exc:
        logger.debug("listing context files failed: %s", exc)
        return []
    out = []
    for src in sources:
        label = str(src.get("label") or "")
        if label == "SOUL.md" or not str(src.get("status") or "").startswith("loaded"):
            continue
        out.append({"kind": "file", "tool": "context_file", "path": str(src.get("path") or label)})
    return out

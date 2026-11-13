"""Sub-tasks (``delegate_task``) in a Timely run: the policy ``timely_gate`` applies and the
lifecycle hooks it registers (phase 4, decisions 5-8 of ``docs/plans/2026-11-13-phase4-work-packages.md``).

- **Where.** Only a chat run that is not from a bot and not no-persist may start sub-tasks
  (``verdict``); bots never get ``delegate_task`` (recursion guard). Go adds the ``delegation``
  toolset only to such runs; this is the second line.
- **Caps.** At most ``policy.CHILDREN_PER_RUN`` children per run in total, across every call; no
  background children (Hermes ignores the model's ``background`` and Timely builds the agent so its
  delegations join inside the call, ``run_chat.build_agent``); ``max_spawn_depth: 1`` and
  ``orchestrator_enabled: false`` (no grandchildren), 20 iterations and 300 s per child (managed
  floors, ``config_render``); a pool of ``policy.CHILD_TOOL_CALL_POOL`` tool calls shared by every
  child of the run, counted by ``timely_gate``.
- **Children read, never propose.** ``timely_gate`` blocks ``propose_changes``, ``session_search``,
  ``skill_manage``, ``memory``, ``clarify`` and ``delegate_task`` in a child (``policy.CHILD_BLOCKED``).
- **Taint.** A child's outside read reaches the parent's run at once with ``via: "subagent"`` and
  ``child`` (``bridge.report_taint``); ``delegate_task`` itself is no taint source.
- **Events.** ``subagent_start`` / ``subagent_stop`` (Hermes' lifecycle hooks, fired on the parent's
  tool thread) record the child on the run and send ``event subagent`` ``{phase, subagent_id,
  child_session_id, goal, status?, tool_calls?}``.
- **Deleting a chat.** Hermes' ``delete_session`` removes delegate children with the parent row; the
  children's live transcripts (``cache/delegation/live/<id>/``, keyed by delegation, not chat) are
  recorded per conversation in ``.timely/delegations.json`` and removed by ``forget``.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Optional

from timely_agent import bridge, policy

logger = logging.getLogger("timely_agent.delegation")

RECORD = Path(".timely") / "delegations.json"
LIVE_ROOT = Path("cache") / "delegation" / "live"
_record_lock = threading.Lock()


def _no_subtasks(run: Optional[bridge.RunContext]) -> bool:
    if run is None:
        return True
    flags = run.flags or {}
    return run.kind != "chat" or flags.get("from_bot") is True or flags.get("no_persist") is True


def verdict(run: Optional[bridge.RunContext], args: dict) -> Optional[dict]:
    """``timely_gate``'s answer for a ``delegate_task`` call of the run itself (None = allow)."""
    if _no_subtasks(run):
        return {"action": "block", "message": policy.CHILD_NOT_HERE}
    if "background" in args and policy.truthy(args.get("background")):
        return {"action": "block", "message": policy.CHILD_BACKGROUND}
    action = str(args.get("action") or "").strip().lower()
    if action and action != "spawn":
        return None  # list/steer/stop start nothing
    n = policy.delegate_task_count(args)
    if n == 0:
        return None  # Hermes answers that the call names no task
    if not run.reserve_children(n, policy.CHILDREN_PER_RUN):
        return {"action": "block", "message": policy.CHILD_CAP.format(n=policy.CHILDREN_PER_RUN)}
    return None


def clarify_verdict(run: Optional[bridge.RunContext]) -> Optional[dict]:
    """``clarify`` runs locally in a chat run (the card, Q-4.3); never in a bot or no-persist run."""
    if _no_subtasks(run):
        return {"action": "block", "message": policy.CLARIFY_NOT_HERE}
    return None


def child_verdict(run: bridge.RunContext, child: str, tool_name: str) -> Optional[dict]:
    """A child's call: the tools only the main assistant uses are blocked, then the shared pool."""
    message = policy.CHILD_BLOCKED.get(tool_name)
    if message:
        return {"action": "block", "message": message}
    if not run.child_call(child, policy.CHILD_TOOL_CALL_POOL):
        return {"action": "block", "message": policy.CHILD_POOL_USED}
    return None


def _emit(run: bridge.RunContext, payload: dict) -> None:
    if run.emit is None:
        return
    try:
        run.emit("subagent", payload)
    except Exception:
        logger.exception("sending a subagent event failed")


def subagent_start(parent_session_id: Any = None, child_session_id: Any = None, child_subagent_id: Any = None,
                   child_goal: Any = None, **_: Any) -> None:
    run = bridge.current_run.get()
    if run is None or not child_session_id:
        return
    goal = str(child_goal or "")[:policy.CHILD_GOAL_CHARS]
    bridge.child_started(run, str(child_session_id), str(child_subagent_id or ""), goal)
    _emit(run, {"phase": "start", "subagent_id": str(child_subagent_id or ""),
                "child_session_id": str(child_session_id), "goal": goal})


def subagent_stop(parent_session_id: Any = None, child_session_id: Any = None, child_status: Any = None,
                  tool_call_history: Any = None, **_: Any) -> None:
    if not child_session_id:
        return
    state = bridge.child_stopped(str(child_session_id))
    run = bridge.current_run.get()
    if run is None:
        return
    calls = state.tool_calls if state is not None else len(tool_call_history or [])
    _emit(run, {"phase": "stop", "subagent_id": state.subagent_id if state else "",
                "child_session_id": str(child_session_id), "goal": state.goal if state else "",
                "status": str(child_status or ""), "tool_calls": calls})


# ---------------------------------------------------------------- live transcripts per chat

def _live_paths(result: Any) -> list[str]:
    try:
        data = json.loads(result) if isinstance(result, str) else result
    except ValueError:
        return []
    out: list[str] = []
    if isinstance(data, dict):
        for p in data.get("live_transcripts") or []:
            if isinstance(p, str):
                out.append(p)
        for entry in data.get("results") or []:
            if isinstance(entry, dict) and isinstance(entry.get("live_transcript"), str):
                out.append(entry["live_transcript"])
    return out


def _home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or ".").resolve()


def record_live(conversation: str, result: Any, home: Optional[Path] = None) -> list[str]:
    """Remember the delegation folders a ``delegate_task`` result names, under the chat."""
    if not conversation:
        return []
    home = home or _home()
    root = (home / LIVE_ROOT).resolve()
    names = []
    for p in _live_paths(result):
        try:
            folder = Path(p).resolve().parent
        except (OSError, ValueError):
            continue
        if folder.parent == root and folder.name not in names:
            names.append(folder.name)
    if not names:
        return []
    with _record_lock:
        data = _read(home)
        have = data.setdefault(conversation, [])
        data[conversation] = list(dict.fromkeys(have + names))
        _write(home, data)
    return names


def forget(conversation: str, home: Optional[Path] = None) -> list[str]:
    """Remove the chat's delegation folders (a deleted chat's sub-task transcripts)."""
    home = home or _home()
    root = (home / LIVE_ROOT).resolve()
    with _record_lock:
        data = _read(home)
        names = data.pop(conversation, None) or []
        if names:
            _write(home, data)
    gone = []
    for name in names:
        folder = (root / str(name)).resolve()
        if folder.parent != root:
            continue
        shutil.rmtree(folder, ignore_errors=True)
        gone.append(str(name))
    return gone


def _read(home: Path) -> dict[str, list[str]]:
    try:
        data = json.loads((home / RECORD).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): [str(n) for n in v if isinstance(n, str)] for k, v in data.items() if isinstance(v, list)}


def _write(home: Path, data: dict[str, list[str]]) -> None:
    path = home / RECORD
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)

"""timely_learning: learning policy, past-chat search and taint reporting (plan section 9b).

**Timely skills are read-only to the agent** (section 9.1, contract test 16). Hermes lets
``skill_manage`` patch and edit a skill under ``skills.external_dirs`` in place, and every
account loads the same staged Timely skills folder, so one account's learning write would
rewrite the skill every other account follows. This hook blocks every ``skill_manage``
action (create, patch, edit, write_file, remove_file, delete, batch operations) whose
target resolves, through Hermes' own ``_find_skill``, under an external skills folder, and
blocks ``write_file`` / ``patch`` on any path inside one: the path arguments, and for ``patch``
in V4A mode (``mode: patch``, which Hermes accepts from any model) every file the patch text
names (``*** Update/Add/Delete File:``, ``*** Move File: a -> b``). Relative paths resolve
against the terminal's working folder (``TERMINAL_CWD``), as Hermes' file tools resolve them.
The rule runs first, in the turn and in the learning pass alike.

**Learning writes** (``memory``, ``skill_manage``; Q-3.1, plan 9b.2): ``learning.rules.decide``
blocks them while ``flags.learning_writes`` is not exactly true (and outside any run or
session), blocks a strict threat-scan hit (reported as a ``blocked`` learning event), stages a
write from a tainted conversation, a bot, an unattended memory patch/remove or one the skill-body
rule matches (``learning.staging``: Hermes' pending store, a ``staged`` event, and the message
"Saved for the person to confirm in Timely; do not retry."), and lets the rest through: the feed
reports them after the run as ``applied`` with Undo. After staging in the turn, the agent's review
counter for that tool is reset (``_iters_since_skill`` / ``_turns_since_memory``): a blocked call
returns before Hermes resets it, and the review would otherwise fire again every turn. In the
learning pass (Hermes' background review fork, a daemon thread after the run) there is no run:
the hook finds the conversation's taint and flags through ``bridge.session_state(session_id)``.

**Past-chat search** (``session_search``, Q-3.5): only when the run says ``flags.search_history``.
``pre_tool_call`` adds the account's "Don't learn from this chat" conversations
(``run.start.search_exclude``) to ``exclude_session_ids`` (a ``modify`` directive), refuses to read
one of them by id and refuses another profile's store; ``transform_tool_result`` drops any of them
from the results as a second line (Hermes keeps at most 20 excluded ids). ``post_tool_call``
taints the searching session with ``{kind: "session", tool: "session_search", session: <id>}``
for each hit from a conversation Go lists in ``tainted_conversations``.

**Taint** (plan 5.2, 9b.2). ``post_tool_call`` adds a source for each call of a tool the policy
marks as a taint source (``policy.TAINT_SOURCES``, ``TAINT_PREFIXES``, any ``mcp-*`` toolset)
that ran (a blocked call brought nothing in), and sends ``taint`` with the new ones. ``tool.call``
and ``run.done`` carry the run's whole list, which starts from ``run.start.tainted_sources``.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger("timely_agent.plugins.timely_learning")

PLUGIN = "timely_learning"
READ_ONLY_MESSAGE = ("Blocked: {name} is a skill shipped with Timely and is read-only. "
                     "Create a learned skill with a new name instead.")
READ_ONLY_PATH_MESSAGE = "Blocked: {path} belongs to a skill shipped with Timely and is read-only."
LEARNING_OFF = ("Blocked: Timely is not saving skills or memory yet. Answer without saving; "
                "do not retry.")
SEARCH_OFF = "Blocked: searching past chats is off for this chat. Answer without it; do not retry."
SEARCH_EXCLUDED = "Blocked: that chat is not searchable. Do not retry."
SEARCH_PROFILE = "Blocked: Timely searches only this account's chats."
LEARNING_TOOLS = ("skill_manage", "memory")
SEARCH_TOOL = "session_search"
PATH_TOOLS = ("write_file", "patch")
PATH_ARGS = ("path", "file_path", "target", "filepath")


def _external_roots() -> list[Path]:
    from agent.skill_utils import get_external_skills_dirs
    roots = [p.resolve() for p in get_external_skills_dirs()]
    try:
        from agent.skill_utils import get_project_skills_dirs
        roots += [p.resolve() for p in get_project_skills_dirs()]
    except Exception:
        pass
    return roots


def _under_external(path: Path) -> bool:
    path = path.expanduser()
    if not path.is_absolute():
        path = Path(os.environ.get("TERMINAL_CWD") or os.getcwd()) / path
    try:
        candidate = path.resolve()
    except (OSError, RuntimeError):
        candidate = path.expanduser().absolute()
    return any(candidate.is_relative_to(root) for root in _external_roots())


_V4A_FILE = re.compile(r"^\*\*\*\s*(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$", re.MULTILINE)
_V4A_MOVE = re.compile(r"^\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+?)\s*$", re.MULTILINE)
_V4A_MOVE_TO = re.compile(r"^\*\*\*\s*Move\s+to:\s*(.+?)\s*$", re.MULTILINE)


def v4a_paths(text: str) -> list[str]:
    """Every file a V4A patch names: Hermes' own parser, plus a plain scan of the marker lines so
    a patch the parser rejects (or a marker form it does not know yet) is still checked."""
    found: list[str] = []
    try:
        from tools.patch_parser import parse_v4a_patch
        ops, _err = parse_v4a_patch(text)
        found += [p for op in ops for p in (op.file_path, op.new_path) if p]
    except Exception as exc:
        logger.warning("V4A parse for the read-only check failed: %s", exc)
    found += _V4A_FILE.findall(text) + _V4A_MOVE_TO.findall(text)
    found += [p for pair in _V4A_MOVE.findall(text) for p in pair]
    return list(dict.fromkeys(p.strip() for p in found if p.strip()))


def _skill_targets(args: dict) -> Iterable[str]:
    name = args.get("name")
    if isinstance(name, str) and name:
        yield name
    ops = args.get("operations")
    if isinstance(ops, list):
        for op in ops:
            if isinstance(op, dict) and isinstance(op.get("name"), str) and op["name"]:
                yield op["name"]


def external_skill(name: str) -> bool:
    """True when ``name`` resolves (as Hermes resolves it) to a skill under an external dir,
    or names a skill folder there."""
    from tools.skill_manager_tool import _find_skill
    from agent.skill_utils import is_external_skill_path
    candidates = {name, Path(name).name}
    for candidate in candidates:
        found = _find_skill(candidate)
        if found and is_external_skill_path(found["path"]):
            return True
    # A Timely skill's name is reserved: a local skill with that name would shadow it
    # (Hermes searches the home's skills/ before external_dirs), e.g. via skill_manage create.
    for root in _external_roots():
        for skill_md in root.rglob("SKILL.md"):
            if skill_md.parent.name in candidates:
                return True
    return False


def pre_tool_call(tool_name: str = "", args: dict | None = None, **_: Any) -> dict | None:
    args = args if isinstance(args, dict) else {}
    try:
        if tool_name == "skill_manage":
            for name in _skill_targets(args):
                if external_skill(name):
                    return {"action": "block", "message": READ_ONLY_MESSAGE.format(name=name)}
            fp = args.get("file_path")
            if isinstance(fp, str) and fp and os.path.isabs(fp) and _under_external(Path(fp)):
                return {"action": "block", "message": READ_ONLY_PATH_MESSAGE.format(path=fp)}
        elif tool_name in PATH_TOOLS:
            values = [args.get(key) for key in PATH_ARGS]
            if tool_name == "patch" and isinstance(args.get("patch"), str):
                values += v4a_paths(args["patch"])
            for value in values:
                if isinstance(value, str) and value and _under_external(Path(value)):
                    return {"action": "block", "message": READ_ONLY_PATH_MESSAGE.format(path=value)}
    except Exception as exc:  # fail closed: a broken check must not let the write through
        logger.warning("read-only skill check failed for %s: %s", tool_name, exc)
        if tool_name == "skill_manage" or tool_name in PATH_TOOLS:
            return {"action": "block", "message": f"Blocked: Timely could not check {tool_name} ({exc})."}
    if tool_name in LEARNING_TOOLS:
        return _learning_write(tool_name, args, str(_.get("session_id") or ""))
    if tool_name == SEARCH_TOOL:
        return _search(args, str(_.get("session_id") or ""))
    return None


class _View:
    """The facts the learning policy needs, from the live run or (in the learning pass, which
    has none) from the conversation's session state."""

    def __init__(self, run, state, fork: bool):
        self.run, self.state, self.fork = run, state, fork
        src = state if state is not None else run
        self.flags = dict(getattr(src, "flags", {}) or {})
        self.kind = str(getattr(src, "kind", "chat") or "chat")
        self.taint = (state.taint_snapshot() if state is not None else run.taint_snapshot())
        self.conversation_id = (run.conversation_id if run is not None else state.session_id)
        self.run_id = run.run_id if run is not None else (state.run_id if state is not None else "")
        self.agent = (run.agent if run is not None else None) or (state.agent if state is not None else None)
        self.search_exclude = set(state.search_exclude) if state is not None else set()
        self.tainted_conversations = set(state.tainted_conversations) if state is not None else set()

    @property
    def learning_writes(self) -> bool:
        return self.flags.get("learning_writes") is True

    @property
    def from_bot(self) -> bool:
        return self.flags.get("from_bot") is True

    @property
    def origin(self) -> str:
        if self.from_bot or self.kind in ("bot", "bot_review"):
            return "bot"
        return "review" if self.fork else "chat"


def _view(session_id: str):
    from timely_agent import bridge
    fork = bridge.in_review_fork()
    run = bridge.current_run.get()
    state = run.session if run is not None else bridge.session_state(session_id)
    if run is None and state is None:
        return None
    return _View(run, state, fork)


def _threat(text: str):
    try:
        from tools.threat_patterns import first_threat_message
    except Exception as exc:  # fail closed
        return f"the threat scan is unavailable ({type(exc).__name__})"
    return first_threat_message(text, scope="strict")


def _unattended() -> bool:
    try:
        from tools.skill_provenance import is_unattended_review
        return bool(is_unattended_review())
    except Exception:
        return True


def _reset_counter(view, tool_name: str) -> None:
    """A staged (blocked) call never reaches Hermes' own reset (tool_executor resets only for a
    call that runs), so reset it here or the review fires again on every turn (plan 9b.2)."""
    agent = view.agent
    if agent is None or view.fork:
        return
    try:
        if tool_name == "skill_manage":
            agent._iters_since_skill = 0
        else:
            agent._turns_since_memory = 0
    except Exception as exc:
        logger.warning("resetting the review counter after staging failed: %s", exc)


def _learning_write(tool_name: str, args: dict, session_id: str) -> dict | None:
    from timely_agent.learning import rules, staging
    view = _view(session_id)
    if view is None:
        return {"action": "block", "message": LEARNING_OFF}
    decision = rules.decide(tool_name, args, learning_writes=view.learning_writes, tainted=bool(view.taint),
                            from_bot=view.from_bot, kind=view.kind, unattended=view.fork and _unattended(),
                            threat=_threat)
    context = dict(origin=view.origin, conversation_id=view.conversation_id, run_id=view.run_id,
                   bot_id="", tainted_sources=view.taint)
    if decision.action == rules.BLOCK:
        if decision.reason == "off":
            return {"action": "block", "message": LEARNING_OFF}
        try:
            staging.blocked_event(tool_name, args, message=decision.message, **context)
        except Exception:
            logger.exception("reporting a blocked learning write failed")
        return {"action": "block", "message": decision.message}
    if decision.action == rules.STAGE:
        try:
            staging.stage(tool_name, args, reason=decision.reason, **context)
        except staging.StageError as exc:
            return {"action": "block", "message": f"Not saved: {exc}"}
        except Exception as exc:  # fail closed: nothing is written unstaged
            logger.exception("staging a learning write failed")
            return {"action": "block", "message": f"Not saved: Timely could not stage it ({type(exc).__name__})."}
        _reset_counter(view, tool_name)
        return {"action": "block", "message": decision.message}
    return None


def _search(args: dict, session_id: str) -> dict | None:
    view = _view(session_id)
    if view is None or view.state is None or not view.state.search_history:
        return {"action": "block", "message": SEARCH_OFF}
    if isinstance(args.get("profile"), str) and args["profile"].strip():
        return {"action": "block", "message": SEARCH_PROFILE}
    if isinstance(args.get("session_id"), str) and args["session_id"] in view.search_exclude:
        return {"action": "block", "message": SEARCH_EXCLUDED}
    if not view.search_exclude:
        return None
    own = args.get("exclude_session_ids")
    own = [own] if isinstance(own, str) else [x for x in own or [] if isinstance(x, str)] \
        if isinstance(own, (list, tuple)) else []
    merged = list(dict.fromkeys(sorted(view.search_exclude) + own))
    return {"action": "modify", "args": {"exclude_session_ids": merged}}


def session_ids_in(value) -> list[str]:
    """Every ``session_id`` a session_search result names (any shape: discover, read, browse)."""
    out: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("session_id", "lineage_root") and isinstance(item, str) and item:
                out.append(item)
            else:
                out += session_ids_in(item)
    elif isinstance(value, list):
        for item in value:
            out += session_ids_in(item)
    return out


def _drop_excluded(value, excluded: set):
    """``value`` without any list item that names an excluded session."""
    if isinstance(value, dict):
        return {k: _drop_excluded(v, excluded) for k, v in value.items()}
    if isinstance(value, list):
        return [_drop_excluded(v, excluded) for v in value
                if not (isinstance(v, dict) and set(session_ids_in(v)) & excluded)]
    return value


def _toolset(tool_name: str) -> str:
    try:
        from tools.registry import registry
        return str(getattr(registry.get_entry(tool_name), "toolset", "") or "")
    except Exception:
        return ""


def post_tool_call(tool_name: str = "", args: dict | None = None, status: str | None = None, **_: Any) -> None:
    """Report outside content that reached the model (a taint source that ran) to Go."""
    if status == "blocked":
        return
    from timely_agent import bridge, policy
    if tool_name == SEARCH_TOOL:
        _search_taint(_.get("result"), str(_.get("session_id") or ""))
        return
    kind = policy.taint_kind(tool_name, _toolset(tool_name))
    if not kind:
        return
    run = bridge.current_run.get()
    if run is None:
        return
    source: dict[str, Any] = {"kind": kind, "tool": tool_name}
    host = policy.taint_host(args)
    if host:
        source["host"] = host
    bridge.report_taint(run, [source])


def _parse(result):
    if isinstance(result, (dict, list)):
        return result
    try:
        return json.loads(result) if isinstance(result, str) else None
    except ValueError:
        return None


def _search_taint(result, session_id: str) -> None:
    """A hit from a tainted conversation taints this one (plan 9b.2): its page text is replayed."""
    from timely_agent import bridge
    run = bridge.current_run.get()
    view = _view(session_id)
    if view is None:
        return
    hits = [sid for sid in dict.fromkeys(session_ids_in(_parse(result)))
            if sid in view.tainted_conversations and sid not in view.search_exclude]
    if not hits:
        return
    sources = [{"kind": "session", "tool": SEARCH_TOOL, "session": sid} for sid in hits]
    if run is not None:
        bridge.report_taint(run, sources)
    elif view.state is not None:
        view.state.add_taint(sources)


def transform_tool_result(tool_name: str = "", result: Any = None, session_id: str = "", **_: Any):
    """Second line for ``search_exclude``: drop excluded conversations from a search result."""
    if tool_name != SEARCH_TOOL:
        return None
    view = _view(str(session_id or ""))
    if view is None or not view.search_exclude:
        return None
    data = _parse(result)
    if data is None or not set(session_ids_in(data)) & view.search_exclude:
        return None
    cleaned = _drop_excluded(data, view.search_exclude)
    if isinstance(cleaned, dict) and isinstance(cleaned.get("results"), list) and "count" in cleaned:
        cleaned["count"] = len(cleaned["results"])
    return json.dumps(cleaned, ensure_ascii=False)


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("transform_tool_result", transform_tool_result)

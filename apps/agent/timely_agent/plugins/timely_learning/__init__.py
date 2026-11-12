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
Go lists the chats a search may return (``run.start.search_allow``: the account's chats that are
neither Sensitive nor "Don't learn from this chat"); a session it does not list (one a restore
brought back without its chat, a deleted chat whose ``session.delete`` is still pending, a bot's)
is never a hit. ``pre_tool_call`` adds the account's "Don't learn from this chat" conversations
(``run.start.search_exclude``) to ``exclude_session_ids`` (a ``modify`` directive), refuses to read
an unlisted or excluded chat by id and refuses another profile's store; ``transform_tool_result``
drops every hit from an unlisted or excluded chat (Hermes keeps at most 20 excluded ids), and
wraps the result as untrusted data (``timely_agent.untrusted``, as Hermes wraps a web result) when a
hit left comes from a chat with outside text (Q-3.9).
``post_tool_call`` taints the searching session with ``{kind: "session", tool: "session_search",
session: <id>}`` for each hit the model reads from a conversation Go lists in
``tainted_conversations`` or that this worker's own state for it holds taint (a chat running at
the same time can read a web page after Go built this run's list). Hermes runs ``transform_tool_result`` after ``post_tool_call`` and
passes the raw result on when a hook fails, so the filter fails closed itself.

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
import threading
from pathlib import Path
from typing import Any, Iterable

from timely_agent import seed

logger = logging.getLogger("timely_agent.plugins.timely_learning")

PLUGIN = "timely_learning"
READ_ONLY_MESSAGE = ("Blocked: {name} is a skill shipped with Timely and is read-only. "
                     "Create a learned skill with a new name instead.")
NAME_MESSAGE = ("Blocked: Timely can't keep a skill named {name} ({why}). Use a plain name of letters, "
                "digits and dashes, such as weekly-review.")
OFF_NAME_MESSAGE = ("Blocked: a skill named {name} stays turned off in Timely, so it would never be used. "
                    "Save it under another name.")
READ_ONLY_PATH_MESSAGE = "Blocked: {path} belongs to a skill shipped with Timely and is read-only."
# The run's learning is off: the person turned learning off for the account or this chat, or the
# chat is Sensitive or only answers. Plain words the model can pass on (review round 7).
LEARNING_OFF = ("Blocked: learning is off for this chat, so Timely saves no skills or memory here. "
                "Answer without saving; do not retry.")
# No run or conversation to learn for (outside a Timely chat or bot run).
NO_LEARNING_RUN = "Blocked: Timely saves skills and memory only inside a chat. Answer without saving; do not retry."
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


def _names_kept_off() -> set[str]:
    """Hermes' skills.disabled for this home (empty in a process without Hermes, such as the unit
    tests; the worker always has it)."""
    try:
        from agent.skill_utils import get_disabled_skill_names
    except ImportError:
        return set()
    return get_disabled_skill_names()


def _created_names(args: dict) -> list[str]:
    """The skills a skill_manage call creates: its own name, and each batch operation's."""
    out = [args["name"]] if args.get("action") == "create" and isinstance(args.get("name"), str) else []
    ops = args.get("operations")
    for op in ops if isinstance(ops, list) else []:
        if isinstance(op, dict) and op.get("action") == "create" and isinstance(op.get("name"), str):
            out.append(op["name"])
    return [n for n in out if n]


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
                if external_skill(name):  # first: a shipped Timely skill reads as read-only, not as a bad name
                    return {"action": "block", "message": READ_ONLY_MESSAGE.format(name=name)}
                if why := seed.learned_name_problem(Path(name).name):
                    # Go could not store it or keep it turned off (hermes-agent never turns off), or the
                    # name is kept for Timely's own skill (``timely``, not shipped yet).
                    return {"action": "block", "message": NAME_MESSAGE.format(name=name, why=why)}
            created = _created_names(args)
            if created:
                # A name Timely keeps off (a denied bundled skill, whatever skills_enabled says) would
                # show as learned and never load.
                off = _names_kept_off()
                for name in created:
                    if Path(name).name in off:
                        return {"action": "block", "message": OFF_NAME_MESSAGE.format(name=name)}
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
        verdict = _learning_write(tool_name, args, str(_.get("session_id") or ""))
        if verdict is None and tool_name == "memory":
            _begin_memory_write(str(_.get("session_id") or ""), str(_.get("tool_call_id") or ""))
        return verdict
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
        if fork:
            # The pass's writes belong to the run that spawned it, not to a later run of the chat
            # that started while it ran (review round 7).
            from timely_agent import bridge
            spawner = bridge.spawning_run()
            if spawner is not None and spawner.run_id:
                self.run_id = spawner.run_id
        self.agent = (run.agent if run is not None else None) or (state.agent if state is not None else None)
        self.search_exclude = set(state.search_exclude) if state is not None else set()
        self.search_allow = set(state.search_allow or []) if state is not None else set()
        self.tainted_conversations = set(state.tainted_conversations) if state is not None else set()

    @property
    def learning_writes(self) -> bool:
        return self.flags.get("learning_writes") is True

    @property
    def from_bot(self) -> bool:
        return self.flags.get("from_bot") is True

    def searchable(self, ids: Iterable[str]) -> bool:
        """Whether a hit naming these session ids (its own, its lineage root) may be returned:
        Go lists one of them, and none is excluded."""
        ids = {i for i in ids if i}
        allowed = self.search_allow | ({self.conversation_id} if self.conversation_id else set())
        return bool(ids & allowed) and not ids & self.search_exclude

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
        return {"action": "block", "message": NO_LEARNING_RUN}
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


_memory_writes: dict[str, tuple[dict, Any]] = {}
_memory_writes_lock = threading.Lock()


def _write_key(session_id: str, tool_call_id: str) -> str:
    return f"{session_id}:{tool_call_id or threading.get_ident()}"


def _begin_memory_write(session_id: str, tool_call_id: str) -> None:
    """A ``memory`` call the policy lets apply: the feed reports its change with this
    conversation's chip (``end_memory_write`` in ``post_tool_call``), not with whichever run's diff
    finds it first."""
    from timely_agent.learning import feed as feed_mod
    feed = feed_mod.current()
    view = _view(session_id)
    if feed is None or view is None:
        return
    key = _write_key(session_id, tool_call_id)
    ctx = feed_mod.Context(origin=view.origin, conversation_id=view.conversation_id, run_id=view.run_id,
                           tainted_sources=list(view.taint))
    try:
        before = feed.begin_memory_write(key)
    except Exception:
        logger.exception("noting a memory write for the learning feed failed")
        return
    with _memory_writes_lock:
        _memory_writes[key] = (before, ctx)


def _end_memory_write(session_id: str, tool_call_id: str, status: str | None) -> None:
    from timely_agent.learning import feed as feed_mod
    with _memory_writes_lock:
        noted = _memory_writes.pop(_write_key(session_id, tool_call_id), None)
    feed = feed_mod.current()
    if noted is None or feed is None:
        return
    before, ctx = noted
    try:
        feed.end_memory_write(_write_key(session_id, tool_call_id), before,
                              None if status == "blocked" else ctx)
    except Exception:
        logger.exception("reporting a memory write to the learning feed failed")


def _search(args: dict, session_id: str) -> dict | None:
    view = _view(session_id)
    if view is None or view.state is None or not view.state.search_history:
        return {"action": "block", "message": SEARCH_OFF}
    if isinstance(args.get("profile"), str) and args["profile"].strip():
        return {"action": "block", "message": SEARCH_PROFILE}
    if isinstance(args.get("session_id"), str) and args["session_id"] and not view.searchable([args["session_id"]]):
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
            if key in ("session_id", "lineage_root", "parent_session_id") and isinstance(item, str) and item:
                out.append(item)
            else:
                out += session_ids_in(item)
    elif isinstance(value, list):
        for item in value:
            out += session_ids_in(item)
    return out


def _drop_unsearchable(value, view):
    """``value`` without any list item that names a session the view may not return."""
    if isinstance(value, dict):
        return {k: _drop_unsearchable(v, view) for k, v in value.items()}
    if isinstance(value, list):
        return [_drop_unsearchable(v, view) for v in value
                if not (isinstance(v, dict) and session_ids_in(v) and not view.searchable(_own_ids(v)))]
    return value


def _own_ids(item: dict) -> list[str]:
    """The ids that name the chat a hit comes from: its session and lineage root (nested
    messages name the same chat)."""
    ids = [item.get(k) for k in ("session_id", "lineage_root", "parent_session_id")]
    return [i for i in ids if isinstance(i, str) and i] or session_ids_in(item)


def _toolset(tool_name: str) -> str:
    try:
        from tools.registry import registry
        return str(getattr(registry.get_entry(tool_name), "toolset", "") or "")
    except Exception:
        return ""


def post_tool_call(tool_name: str = "", args: dict | None = None, status: str | None = None, **_: Any) -> None:
    """Report outside content that reached the model (a taint source that ran) to Go, and a
    ``memory`` write's own change to the learning feed."""
    if tool_name == "memory":
        _end_memory_write(str(_.get("session_id") or ""), str(_.get("tool_call_id") or ""), status)
    if status == "blocked":
        return
    if tool_name == "skill_manage":
        _report_pass_skill(str(_.get("session_id") or ""))
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


def _report_pass_skill(session_id: str) -> None:
    """A learning pass's ``skill_manage`` reports its own ledger entries at once, with the chip of
    the run that spawned the pass: a later run of the chat that started meanwhile must not find
    them in its own diff and show them under its reply (review round 7)."""
    from timely_agent import bridge
    from timely_agent.learning import feed as feed_mod
    if not bridge.in_review_fork():
        return
    feed = feed_mod.current()
    view = _view(session_id)
    if feed is None or view is None or not view.conversation_id:
        return
    ctx = feed_mod.Context(origin=view.origin, conversation_id=view.conversation_id, run_id=view.run_id,
                           tainted_sources=list(view.taint))

    def own(entry: dict) -> bool:
        evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
        return entry.get("actor") == "curator" and str(evidence.get("session_id") or "") == view.conversation_id

    try:
        with feed.lock:
            for entry in feed.claim_ledger(keep=own):
                ev = feed_mod.ledger_event(feed.home, entry, ctx)
                if ev is not None:
                    feed.emit(ev)
    except Exception:
        logger.exception("reporting a learning pass's skill change failed")


def _hit_ids(value) -> list[list[str]]:
    """The ids of each hit (the innermost dicts that name a session), or of the whole result."""
    out: list[list[str]] = []
    if isinstance(value, dict):
        nested = [ids for v in value.values() for ids in _hit_ids(v)]
        own = [value.get(k) for k in ("session_id", "lineage_root", "parent_session_id")]
        own = [i for i in own if isinstance(i, str) and i]
        out += ([own] if own else []) + nested
    elif isinstance(value, list):
        out += [ids for v in value for ids in _hit_ids(v)]
    return out


def _parse(result):
    if isinstance(result, (dict, list)):
        return result
    try:
        return json.loads(result) if isinstance(result, str) else None
    except ValueError:
        return None


def _live_taint(session_id: str) -> bool:
    """Whether this worker saw the conversation read outside content. Go lists tainted chats
    once, at ``run.start``; another chat of the account that is running at the same time can
    read a web page after that, and only the worker's own state knows it then."""
    from timely_agent import bridge
    state = bridge.session_state(session_id)
    return state is not None and bool(state.taint_snapshot())


def _search_taint(result, session_id: str) -> None:
    """A hit from a tainted conversation taints this one (plan 9b.2): its page text is replayed."""
    from timely_agent import bridge
    run = bridge.current_run.get()
    view = _view(session_id)
    if view is None:
        return
    hits: list[str] = []
    for ids in _hit_ids(_parse(result)):
        ids = [i for i in ids if i != view.conversation_id]
        if not ids or set(ids) & view.search_exclude:
            continue
        if not view.searchable(ids):
            continue  # transform_tool_result drops it: the model never reads it
        hits += [i for i in ids if i in view.tainted_conversations or _live_taint(i)]
    hits = list(dict.fromkeys(hits))
    if not hits:
        return
    sources = [{"kind": "session", "tool": SEARCH_TOOL, "session": sid} for sid in hits]
    if run is not None:
        bridge.report_taint(run, sources)
    elif view.state is not None:
        view.state.add_taint(sources)


def _tainted_hits(data, view) -> list[str]:
    """The chats with outside text that the hits of a (filtered) search result come from."""
    hits: list[str] = []
    for ids in _hit_ids(data):
        ids = [i for i in ids if i != view.conversation_id]
        hits += [i for i in ids if i in view.tainted_conversations or _live_taint(i)]
    return list(dict.fromkeys(hits))


def transform_tool_result(tool_name: str = "", result: Any = None, session_id: str = "",
                          tool_call_id: str = "", **_: Any):
    """Drop every hit from a chat Go does not list as searchable (``search_allow``) or excludes,
    and wrap the result as untrusted data (as Hermes wraps a web result) when a hit left comes
    from a chat that read outside content: its text may quote a page (owner decision Q-3.9)."""
    if tool_name != SEARCH_TOOL:
        return None
    refused = json.dumps({"success": False, "error": "Timely could not check which chats this search may return."})
    try:
        view = _view(str(session_id or ""))
        data = _parse(result)
        if view is None or (data is None and isinstance(result, str) and result.strip()):
            return refused  # fail closed: Hermes passes the raw result on when a hook fails
        if data is None:
            return None
        cleaned = _drop_unsearchable(data, view)
        changed = cleaned != data
        if changed and isinstance(cleaned, dict) and isinstance(cleaned.get("results"), list) and "count" in cleaned:
            cleaned["count"] = len(cleaned["results"])
        tainted = bool(_tainted_hits(cleaned, view))
        if not changed and not tainted:
            return None
        out = result if not changed and isinstance(result, str) else json.dumps(cleaned, ensure_ascii=False)
        if tainted:
            from timely_agent import bridge, untrusted
            return untrusted.mark(bridge.current_run.get(), SEARCH_TOOL, tool_call_id, out)
        return out
    except Exception:
        logger.exception("filtering a past-chat search result failed")
        return refused


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("transform_tool_result", transform_tool_result)

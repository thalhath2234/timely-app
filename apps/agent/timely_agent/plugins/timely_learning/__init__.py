"""timely_learning: learning policy and taint reporting (plan section 9b).

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

**Learning writes are off unless the run says otherwise** (plan 9b, phase 2). While
``run.start.flags.learning_writes`` is not exactly true (phase 2 always sends false), every
``skill_manage`` action (all of them write) and every ``memory`` call is blocked; outside a run
too. The read-only rule runs first, so a write to a Timely skill keeps its own message.

**Taint** (plan 5.2, 9b.2). ``post_tool_call`` adds a source for each call of a tool the policy
marks as a taint source (``policy.TAINT_SOURCES``, ``TAINT_PREFIXES``, any ``mcp-*`` toolset)
that ran (a blocked call brought nothing in), and sends ``taint`` with the new ones. ``tool.call``
and ``run.done`` carry the run's whole list, which starts from ``run.start.tainted_sources``.

Staging and review policy arrive in phase 3.
"""

from __future__ import annotations

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
LEARNING_TOOLS = ("skill_manage", "memory")
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
        from timely_agent import bridge
        run = bridge.current_run.get()
        if run is None or not run.learning_writes:
            return {"action": "block", "message": LEARNING_OFF}
    return None


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


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)

"""timely_learning: learning policy (plan section 9b). Phase 1 ships one real rule.

**Timely skills are read-only to the agent** (section 9.1, contract test 16). Hermes lets
``skill_manage`` patch and edit a skill under ``skills.external_dirs`` in place, and every
account loads the same staged Timely skills folder, so one account's learning write would
rewrite the skill every other account follows. This hook blocks every ``skill_manage``
action (create, patch, edit, write_file, remove_file, delete, batch operations) whose
target resolves, through Hermes' own ``_find_skill``, under an external skills folder, and
blocks ``write_file`` / ``patch`` on any path inside one.

Taint reporting, staging and review policy arrive in phase 3.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger("timely_agent.plugins.timely_learning")

PLUGIN = "timely_learning"
READ_ONLY_MESSAGE = ("Blocked: {name} is a skill shipped with Timely and is read-only. "
                     "Create a learned skill with a new name instead.")
READ_ONLY_PATH_MESSAGE = "Blocked: {path} belongs to a skill shipped with Timely and is read-only."
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
    try:
        candidate = path.expanduser().resolve()
    except (OSError, RuntimeError):
        candidate = path.expanduser().absolute()
    return any(candidate.is_relative_to(root) for root in _external_roots())


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
            for key in PATH_ARGS:
                value = args.get(key)
                if isinstance(value, str) and value and _under_external(Path(value)):
                    return {"action": "block", "message": READ_ONLY_PATH_MESSAGE.format(path=value)}
    except Exception as exc:  # fail closed: a broken check must not let the write through
        logger.warning("read-only skill check failed for %s: %s", tool_name, exc)
        if tool_name == "skill_manage" or tool_name in PATH_TOOLS:
            return {"action": "block", "message": f"Blocked: Timely could not check {tool_name} ({exc})."}
    return None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)

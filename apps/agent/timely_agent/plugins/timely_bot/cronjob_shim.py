"""The ``cronjob_manage`` shim (plan 7.10): Hermes' scheduling tool, answered by Timely.

Upstream ``tools/cronjob_tools.py`` registers ``cronjob_manage`` (toolset ``cronjob``) at import,
whatever the toolset config says. A plugin cannot shadow a built-in name without ``override=True``
plus ``plugins.entries.<id>.allow_tool_override: true``, which the managed config grants to
``timely_bot`` only (``config_render.managed_floors``). So this module registers the tool again under
its own toolset ``timely_schedule`` (never ``cronjob``, which stays disabled) with ``override=True``;
the 12 Hermes skills that call ``cronjob_manage`` keep working. Nothing here schedules anything in
Hermes: ``create``, ``update``, ``pause``, ``resume`` and ``remove`` become a ``create_bot`` /
``update_bot`` proposal (``propose_changes``, so the person approves it and the usual permission mode
applies), ``list`` reads the person's bots, and ``run`` / ``cancel`` say that a bot is run from its
page. Only chat runs are given the toolset; a bot tick never is (plan 7.5).

Two runtime overrides make it stick (``patches.md``): the managed floor ``agent.disabled_toolsets`` lists
``cronjob`` and Hermes subtracts a toolset by tool *name*, so :func:`neutralise_upstream_toolset` empties
Hermes' static ``cronjob`` toolset; and :func:`ensure` re-registers the shim if upstream's import took the
name back.

The tool policy keys on the handler's owner (``selftest`` checks the resolved handler's module is
this one, ``policy.SHIM_MODULE``); :func:`ensure` re-registers it when something else took the name
back after plugin discovery.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from timely_agent import policy

logger = logging.getLogger("timely_agent.plugins.timely_bot")

TOOL = "cronjob_manage"
TOOLSET = policy.SCHEDULE_TOOLSET

SCHEMA: dict[str, Any] = {
    "name": TOOL,
    "description": (
        "Schedule recurring work for the person as a Timely bot: action='create' (needs prompt and schedule), "
        "'list', 'update', 'pause', 'resume', 'remove' by job_id (a bot id; always list first, never guess ids). "
        "Nothing is scheduled until the person approves the proposal this makes. A bot runs on its schedule with "
        "no chat context, so the prompt must be self-contained, and its final response is what is delivered."),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "description": "One of: create, list, update, pause, resume, remove."},
            "job_id": {"type": "string", "description": "The bot id, for update/pause/resume/remove."},
            "name": {"type": "string", "description": "A short name for the bot."},
            "prompt": {"type": "string", "description": "What the bot should do each run, self-contained."},
            "schedule": {"type": "string",
                         "description": "'30m', 'every 2h', 'weekdays at 9am', or cron syntax like '0 9 * * *'."},
            "skills": {"type": "array", "items": {"type": "string"}, "description": "Skills loaded before the prompt."},
        },
        "required": ["action"],
    },
}
NOT_HERE = "A bot is run from its page (Try it now); this tool cannot run or cancel one."
NEED = "action={action} needs {fields}."


def _error(message: str) -> str:
    return json.dumps({"error": message})


def _proposal(summary: str, tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {"summary": summary, "steps": [{"tool": tool, "summary": summary, "arguments": arguments}],
            "direct": False, "reply": "", "remaining": "", "language": "en"}


def proposal_for(args: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """The ``propose_changes`` arguments an action maps to, or ``(None, why)``."""
    action = str(args.get("action") or "").strip().lower()
    job = str(args.get("job_id") or "").strip()
    name = str(args.get("name") or "").strip()
    fields: dict[str, Any] = {}
    for key in ("name", "prompt", "schedule"):
        if isinstance(args.get(key), str) and args[key].strip():
            fields[key] = args[key].strip()
    if isinstance(args.get("skills"), list):
        fields["skills"] = [str(s) for s in args["skills"] if isinstance(s, str) and s.strip()]
    if action == "create":
        missing = [k for k in ("prompt", "schedule") if k not in fields]
        if missing:
            return None, NEED.format(action=action, fields=" and ".join(missing))
        fields.setdefault("name", fields["prompt"][:40])
        return _proposal(f"Make a bot: {fields['name']}", "create_bot", fields), ""
    if action in ("update", "pause", "resume", "remove"):
        if not job:
            return None, NEED.format(action=action, fields="job_id")
        if action == "update":
            if not fields:
                return None, "action=update needs something to change: name, prompt, schedule or skills."
            return _proposal(f"Change the bot {name or job}", "update_bot", {"bot": job, **fields}), ""
        paused = action in ("pause", "remove")
        verb = {"pause": "Pause", "resume": "Resume", "remove": "Stop"}[action]
        return _proposal(f"{verb} the bot {name or job}", "update_bot", {"bot": job, "paused": paused}), ""
    return None, f"action {action!r} is not available here"


def handle(args: Any = None, **kw: Any) -> str:
    """The shim's handler: Go answers; a proposal goes through the chat's ``propose_changes`` path."""
    from timely_agent.plugins import timely_tools
    args = args if isinstance(args, dict) else {}
    action = str(args.get("action") or "").strip().lower()
    if action in ("run", "cancel"):
        return _error(NOT_HERE)
    if action == "list":
        return timely_tools.make_handler("list_bots")({}, **kw)
    proposal, why = proposal_for(args)
    if proposal is None:
        return _error(why)
    return timely_tools.make_handler("propose_changes")(proposal, **kw)


def register(ctx: Any) -> Any:
    """Register the shim over upstream's ``cronjob_manage`` (needs the managed ``allow_tool_override``)."""
    return ctx.register_tool(name=TOOL, toolset=TOOLSET, schema=SCHEMA, handler=handle,
                             description=SCHEMA["description"], override=True)


def resolved_module() -> str:
    """The module of the handler the registry resolves for ``cronjob_manage`` ("" when none)."""
    from tools.registry import registry
    return str(getattr(getattr(registry.get_entry(TOOL), "handler", None), "__module__", "") or "")


def neutralise_upstream_toolset() -> bool:
    """Empty Hermes' static ``cronjob`` toolset (runtime override R9, ``patches.md``). The managed floor
    subtracts ``cronjob`` from every agent, and Hermes subtracts a toolset *by tool name*: its static list
    names ``cronjob_manage``, which is also the shim's name, so the floor would hide the shim from every
    chat. With the list empty the subtraction removes nothing, the shim (toolset ``timely_schedule``) stays,
    and the upstream toolset still offers nothing if anything enabled it (``run.start`` refuses it anyway).
    True when the toolset holds no tool afterwards."""
    try:
        import toolsets
    except ImportError:  # Hermes is not loaded (unit tests): nothing to empty
        return True
    entry = toolsets.TOOLSETS.get("cronjob")
    if isinstance(entry, dict) and entry.get("tools"):
        entry["tools"] = []
        memo = getattr(toolsets, "_resolve_toolset_memo", None)
        if hasattr(memo, "clear"):
            memo.clear()
    return not (isinstance(entry, dict) and entry.get("tools"))


def ensure() -> bool:
    """Make sure the registry holds the shim (upstream's import may have re-registered after plugin
    discovery); True when it does. Direct ``registry.register(override=True)``, as the plugin did."""
    neutralise_upstream_toolset()
    if resolved_module() == policy.SHIM_MODULE:
        return True
    from tools.registry import registry
    registry.register(name=TOOL, toolset=TOOLSET, schema=SCHEMA, handler=handle,
                      description=SCHEMA["description"], override=True)
    return resolved_module() == policy.SHIM_MODULE

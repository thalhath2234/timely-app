"""The worker self-test reported in ``ready.self_test`` (plan section 5.1 rules, contract test 8).

Checks, each ``{"name", "ok", "detail"}``:

- ``plugins``       the four Timely plugins are loaded and enabled, without errors
- ``gate_hook``     ``pre_tool_call`` carries timely_gate's and timely_learning's callbacks
- ``home``          ``HERMES_HOME`` is the folder Go named in ``hello`` and Hermes resolves it
- ``no_messaging``  no messaging tool resolves for any toolset a Timely run may enable, no
                    platform plugin is enabled and no platform adapter module is imported
- ``managed_config`` the managed floors read back through Hermes' loaders (canary)
- ``install_guard`` every runtime-install override is in place
- ``mcp``           no ``command`` MCP server unless the account is host-allowed and approved it

If any check fails the worker answers ``ready`` with ``self_test.ok = false`` and refuses runs.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from timely_agent import config_render, install_guard, policy
from timely_agent.plugin_dist import PLUGINS

# Every toolset a Timely chat or bot run may be given (section 8.1); the messaging check
# resolves tools for all of them at once.
OFFERABLE_TOOLSETS = [
    "todo", "skills", "memory", "session_search", "web", "vision", "file", "terminal",
    "code_execution", "browser-use", "browser-cdp", "delegation", "clarify", "timely",
]


def _check(name: str, ok: bool, detail: str = "") -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail}


def resolved_tools(toolsets: list[str]) -> list[str]:
    import model_tools
    defs = model_tools.get_tool_definitions(enabled_toolsets=list(toolsets), quiet_mode=True) or []
    return sorted({(d.get("function") or {}).get("name", "") for d in defs} - {""})


def platform_modules() -> list[str]:
    """Imported messaging adapter modules (``plugins.platforms.<name>`` and Hermes' built-in
    ``gateway.platforms.<name>`` adapters). The worker never starts the gateway, so none
    should ever be imported (section 8.3 layer 1; contract test 11)."""
    import sys
    prefixes = ("plugins.platforms.", "gateway.platforms.")
    return sorted(m for m in list(sys.modules) if m.startswith(prefixes)
                  and m.rsplit(".", 1)[-1] not in ("base", "__init__"))


def _account_state(home: Path) -> dict[str, Any]:
    import json
    try:
        return json.loads((home / config_render.ACCOUNT_STATE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def run(*, expected_home: str, timely_skills_dir: str | None) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    from hermes_cli.plugins import get_plugin_manager
    from hermes_constants import get_hermes_home

    manager = get_plugin_manager()
    loaded = {p.get("key") or p.get("name"): p for p in manager.list_plugins()}
    missing = []
    for name in PLUGINS:
        info = loaded.get(name)
        if not info or not info.get("enabled") or info.get("error"):
            missing.append(f"{name}: {info.get('error') if info else 'not discovered'}")
    checks.append(_check("plugins", not missing, "; ".join(missing)))

    callbacks = list(manager.iter_hook_callbacks("pre_tool_call")) if hasattr(manager, "iter_hook_callbacks") \
        else list(getattr(manager, "_hooks", {}).get("pre_tool_call", []))
    modules = {getattr(cb, "__module__", "") for cb in callbacks}
    need = {"timely_agent.plugins.timely_gate", "timely_agent.plugins.timely_learning"}
    checks.append(_check("gate_hook", need <= modules, "" if need <= modules else f"registered: {sorted(modules)}"))

    want_home = Path(expected_home).resolve()
    env_home = Path(os.environ.get("HERMES_HOME", "")).resolve()
    got_home = Path(get_hermes_home()).resolve()
    ok_home = want_home == env_home == got_home
    checks.append(_check("home", ok_home, "" if ok_home else f"want {want_home}, env {env_home}, hermes {got_home}"))

    try:
        tools = resolved_tools(OFFERABLE_TOOLSETS)
        bad = [t for t in tools if policy.is_messaging(t)]
        bad += [f"plugin {k} enabled" for k, p in loaded.items()
                if p.get("enabled") and (p.get("kind") == "platform" or str(k).startswith("platforms/"))]
        bad += [f"adapter {m} imported" for m in platform_modules()]
        checks.append(_check("no_messaging", not bad, ", ".join(bad)))
    except Exception as exc:
        tools = []
        checks.append(_check("no_messaging", False, f"could not resolve tools: {exc}"))

    try:
        problems = config_render.canary(timely_skills_dir)
    except Exception as exc:
        problems = [f"canary raised {type(exc).__name__}: {exc}"]
    checks.append(_check("managed_config", not problems, "; ".join(problems)))

    try:
        from agent.skill_utils import ESSENTIAL_SKILLS
        from timely_agent.seed import ESSENTIAL_SKILLS as ours
        same = set(ESSENTIAL_SKILLS) == set(ours)
        checks.append(_check("essential_skills", same,
                             "" if same else f"Hermes {sorted(ESSENTIAL_SKILLS)} != seed.py {sorted(ours)}"))
    except Exception as exc:
        checks.append(_check("essential_skills", False, f"{type(exc).__name__}: {exc}"))

    try:
        guard = install_guard.active()
    except Exception:
        guard = False
    checks.append(_check("install_guard", guard, "" if guard else "runtime install overrides are missing"))

    try:
        from hermes_cli.config import load_config
        state = _account_state(want_home)
        approved = set(state.get("approved_mcp_hashes") or []) if state.get("host_allowed") else set()
        servers = load_config().get("mcp_servers") or {}
        stdio = [n for n, e in servers.items() if isinstance(e, dict) and e.get("command")
                 and config_render.mcp_entry_hash(e) not in approved]
        checks.append(_check("mcp", not stdio, f"command servers not approved for this account: {stdio}" if stdio else ""))
    except Exception as exc:
        checks.append(_check("mcp", False, f"could not read mcp_servers: {exc}"))

    return {"ok": all(c["ok"] for c in checks), "checks": checks, "tools": tools}

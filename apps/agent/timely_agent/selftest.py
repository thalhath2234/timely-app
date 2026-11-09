"""The worker self-test reported in ``ready.self_test`` (plan section 5.1 rules, contract test 8).

Checks, each ``{"name", "ok", "detail"}``:

- ``plugins``       the four Timely plugins are loaded and enabled, without errors, from Timely's
                    own entry points (``timely_agent/plugins``), and the enabled set is exactly
                    ``EXPECTED_PLUGINS``: a new bundled backend after a sync fails here until
                    it is reviewed and added
- ``user_plugins``  ``$HERMES_HOME/plugins`` is empty and project plugins are off. Hermes lets
                    a folder there replace an entry point or bundled plugin with the same key,
                    so ``plugins/timely_gate/`` in the home would switch the gate off
- ``gate_hook``     ``pre_tool_call`` carries timely_gate's and timely_learning's own functions
                    (compared by identity, never by ``__module__``, which any plugin can set)
- ``dotenv``        no dotenv file Hermes loads exists (``env_check.dotenv_files``)
- ``env_drift``     nothing changed the worker environment after the start check, except the
                    worker's own terminal bridge
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

from timely_agent import config_render, env_check, install_guard, paths, policy
from timely_agent.plugin_dist import PLUGINS

# The enabled plugin set at the synced Hermes tag: Timely's four plus the bundled backends Hermes
# auto-loads (browser providers, the delegation backend and the web search backends). A sync
# that adds, renames or drops one fails the self-test (contract test 11) until it is reviewed
# here and in plan section 2 "Bundled general plugins".
EXPECTED_PLUGINS = frozenset({
    *PLUGINS,
    "browser/browser_use", "browser/browserbase", "browser/firecrawl",
    "delegation/default",
    "web/brave_free", "web/ddgs", "web/exa", "web/firecrawl", "web/keenable", "web/openai_native",
    "web/parallel", "web/perplexity", "web/searxng", "web/tavily", "web/xai",
})

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


def _cb_name(cb: Any) -> str:
    return f"{getattr(cb, '__module__', '?')}.{getattr(cb, '__qualname__', '?')}"


def timely_plugin_problems(manager: Any, loaded: dict[str, dict[str, Any]]) -> list[str]:
    """Each Timely plugin must be enabled, error-free and loaded from Timely's own entry point:
    manifest source ``entrypoint``, target ``timely_agent.plugins.<name>:register``, module file
    under ``timely_agent/plugins``. A same-key folder plugin wins over an entry point in Hermes'
    discovery, so the key alone proves nothing."""
    problems = []
    plugins_dir = (paths.agent_dir() / "timely_agent" / "plugins").resolve()
    records = getattr(manager, "_plugins", {}) or {}
    for name in PLUGINS:
        info = loaded.get(name)
        if not info or not info.get("enabled") or info.get("error"):
            problems.append(f"{name}: {info.get('error') if info else 'not discovered'}")
            continue
        record = records.get(name)
        manifest = getattr(record, "manifest", None)
        source, target = getattr(manifest, "source", None), getattr(manifest, "path", None)
        if source != "entrypoint" or target != f"timely_agent.plugins.{name}:register":
            problems.append(f"{name}: loaded from {source} {target}, not Timely's entry point")
            continue
        module = getattr(record, "module", None)
        try:
            where = Path(getattr(module, "__file__", "") or "").resolve()
            ok = where.is_file() and where.parent.parent == plugins_dir and where.parent.name == name
        except (OSError, ValueError):
            ok = False
        if not ok:
            problems.append(f"{name}: module {getattr(module, '__file__', None)} is not under {plugins_dir}")
    return problems


def user_plugin_entries(home: Path) -> list[str]:
    """Anything in ``$HERMES_HOME/plugins`` (Hermes scans it for user plugins), plus a note when
    project plugins are switched on. Timely never puts anything there."""
    out = []
    folder = home / "plugins"
    try:
        out = sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []
    except OSError as exc:
        out = [f"unreadable: {exc}"]
    if folder.exists() and not folder.is_dir():
        out.append("plugins is not a folder")
    if os.environ.get("HERMES_ENABLE_PROJECT_PLUGINS", "").strip():
        out.append("HERMES_ENABLE_PROJECT_PLUGINS is set")
    return out


def run(*, expected_home: str, timely_skills_dir: str | None,
        env_before: dict[str, str] | None = None, env_ignore: frozenset[str] | set[str] = frozenset()) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    from hermes_cli.plugins import get_plugin_manager
    from hermes_constants import get_hermes_home

    manager = get_plugin_manager()
    loaded = {p.get("key") or p.get("name"): p for p in manager.list_plugins()}
    problems = timely_plugin_problems(manager, loaded)
    enabled = {k for k, p in loaded.items() if p.get("enabled")}
    if enabled != EXPECTED_PLUGINS:
        extra, gone = sorted(enabled - EXPECTED_PLUGINS), sorted(EXPECTED_PLUGINS - enabled)
        problems.append(f"enabled plugins differ from the reviewed set: extra {extra}, missing {gone}")
    checks.append(_check("plugins", not problems, "; ".join(problems)))

    want_home = Path(expected_home).resolve()
    stray = user_plugin_entries(want_home)
    checks.append(_check("user_plugins", not stray, f"plugin folders Timely does not load: {stray}" if stray else ""))

    try:
        from timely_agent.plugins import timely_gate, timely_learning
        callbacks = list(manager.iter_hook_callbacks("pre_tool_call"))
        need = {"timely_gate": timely_gate.pre_tool_call, "timely_learning": timely_learning.pre_tool_call}
        absent = [name for name, fn in need.items() if not any(cb is fn for cb in callbacks)]
        checks.append(_check("gate_hook", not absent,
                             f"pre_tool_call lacks {absent}; registered: {[_cb_name(cb) for cb in callbacks]}"
                             if absent else ""))
    except Exception as exc:
        checks.append(_check("gate_hook", False, f"{type(exc).__name__}: {exc}"))

    files = env_check.dotenv_files(want_home, paths.hermes_dir(), os.environ.get("HERMES_MANAGED_DIR"))
    checks.append(_check("dotenv", not files, f"dotenv files Hermes loads over the worker environment: "
                                              f"{[str(f) for f in files]}" if files else ""))
    if env_before is not None:
        changed = env_check.drift(env_before, os.environ, ignore=env_ignore)
        checks.append(_check("env_drift", not changed,
                             f"the worker environment changed after the start check: {changed}" if changed else ""))

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

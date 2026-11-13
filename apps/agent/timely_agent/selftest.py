"""The worker self-test reported in ``ready.self_test`` (plan section 5.1 rules, contract test 8).

Checks, each ``{"name", "ok", "detail"}``:

- ``plugins``       every Timely plugin (each folder under ``timely_agent/plugins/``) is loaded and enabled, without errors, from Timely's
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
- ``managed_config`` the managed file is byte-identical to the floors rendered from the values Go
                    sent in ``hello`` and every leaf reads back through Hermes' loaders (canary)
- ``essential_skills`` Hermes' non-disableable skill list matches ``seed.ESSENTIAL_SKILLS``
- ``install_guard`` every runtime-install override is in place
- ``dotenv_guard``  Hermes' dotenv loader is a no-op after start (runtime override R2)
- ``mcp``           no ``command`` MCP server unless the account is host-allowed and approved it
- ``timely_tools``  every spec from ``hello.timely_tools`` is registered under toolset ``timely``
                    with timely_tools' own handler, and nothing else is in that toolset
- ``no_sign_in``    Q-4.1: no Hermes sign-in in the home (``auth.json``, ``.anthropic_oauth.json``),
                    borrowing another app's login is off, and no ``model``, ``delegation`` or
                    ``auxiliary.*`` provider in the effective config is a sign-in provider or one
                    Timely does not run (``policy.ALLOWED_PROVIDERS``, ``auto`` or empty), and
                    runtime override R5 keeps Hermes' auxiliary resolver off the Nous sign-in

If any check fails the worker answers ``ready`` with ``self_test.ok = false`` and refuses runs.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from timely_agent import config_render, dotenv_guard, env_check, install_guard, paths, policy
from timely_agent.plugin_dist import PLUGINS

# The enabled plugin set at the synced Hermes tag: Timely's own (``plugin_dist.PLUGINS``) plus the bundled backends Hermes
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


def run(*, expected_home: str, timely_skills_dir: str | None, browser_executable: str = "",
        managed_sha256: str | None = None, env_before: dict[str, str] | None = None, env_ignore: frozenset[str] | set[str] = frozenset(),
        required_disabled: list[str] | None = None, timely_tools: list[str] | None = None) -> dict[str, Any]:
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
        problems = config_render.canary(timely_skills_dir, browser_executable, managed_sha256)
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
        frozen = dotenv_guard.active()
    except Exception:
        frozen = False
    checks.append(_check("dotenv_guard", frozen, "" if frozen else "Hermes' dotenv loader can still reload .env files"))

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

    if required_disabled is not None:
        # Reviewed default-off skills (hello's skills_default_off, less what the person turned on)
        # must all be in the effective skills.disabled.
        try:
            from hermes_cli.config import load_config
            have = {str(n) for n in ((load_config().get("skills") or {}).get("disabled") or [])}
            gone = sorted(set(required_disabled) - have)
            checks.append(_check("skills_default_off", not gone,
                                 f"default-off skills missing from skills.disabled: {gone}" if gone else ""))
        except Exception as exc:
            checks.append(_check("skills_default_off", False, f"could not read skills.disabled: {exc}"))

    registered: list[str] = []
    try:
        problems, registered = timely_tool_problems(list(timely_tools or []))
        checks.append(_check("timely_tools", not problems, "; ".join(problems)))
    except Exception as exc:
        checks.append(_check("timely_tools", False, f"{type(exc).__name__}: {exc}"))

    try:
        from hermes_cli.config import load_config
        problems = sign_in_problems(want_home, load_config(), oauth_provider_ids())
        from timely_agent import sign_in_guard
        if not sign_in_guard.active():
            problems.append("Hermes' auxiliary resolver can still try the Nous sign-in (override R5 missing)")
        checks.append(_check("no_sign_in", not problems, "; ".join(problems)))
    except Exception as exc:
        checks.append(_check("no_sign_in", False, f"{type(exc).__name__}: {exc}"))

    return {"ok": all(c["ok"] for c in checks), "checks": checks, "tools": tools,
            "timely_registered": registered}


def oauth_provider_ids() -> set[str]:
    """Hermes provider ids that sign in (OAuth, device code, an external login): Timely's list plus
    every registry entry whose auth type says so, so a sign-in provider added upstream is caught."""
    ids = set(policy.OAUTH_PROVIDERS)
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY
        for name, cfg in PROVIDER_REGISTRY.items():
            auth = str(getattr(cfg, "auth_type", "") or "")
            if auth.startswith("oauth") or auth in ("external_process",):
                ids.add(str(name))
    except Exception:
        pass
    return ids


def sign_in_problems(home: Path, cfg: Any, oauth_ids: set[str]) -> list[str]:
    """Q-4.1 (pure, for the self-test and unit tests): what in the home or the effective config
    would let Hermes sign in or borrow a login."""
    problems = []
    for name in policy.OAUTH_FILES:
        path = Path(home) / name
        if path.exists() or path.is_symlink():
            problems.append(f"{name} is in the account home (a Hermes sign-in)")
    cfg = cfg if isinstance(cfg, dict) else {}
    if config_render.get_dotted(cfg, "auth.adopt_external_logins") is not False:
        problems.append("auth.adopt_external_logins is not false (Hermes would borrow the Claude Code login)")
    keys = [("model.provider", config_render.get_dotted(cfg, "model.provider")),
            ("delegation.provider", config_render.get_dotted(cfg, "delegation.provider"))]
    aux = cfg.get("auxiliary")
    for task, entry in (aux.items() if isinstance(aux, dict) else []):
        if isinstance(entry, dict):
            keys.append((f"auxiliary.{task}.provider", entry.get("provider")))
    for key, value in keys:
        if not isinstance(value, str) or value.strip().lower() in ("", "auto"):
            continue
        if value in oauth_ids:
            problems.append(f"{key} is {value!r}, a sign-in provider")
        elif value not in policy.ALLOWED_PROVIDERS:
            problems.append(f"{key} is {value!r}, a provider Timely does not run")
    return problems


def timely_tool_problems(expected: list[str]) -> tuple[list[str], list[str]]:
    """``(problems, registered names)``: the ``timely`` toolset must hold exactly the specs Go
    sent, each with timely_tools' handler (a same-name tool from anywhere else is a failure)."""
    from tools.registry import registry
    from timely_agent.plugins import timely_tools as plugin
    problems: list[str] = []
    have = sorted(registry.get_tool_names_for_toolset(plugin.TOOLSET) or [])
    if sorted(expected) != have:
        problems.append(f"timely toolset {have} differs from hello.timely_tools {sorted(expected)}")
    for name in have:
        handler = getattr(registry.get_entry(name), "handler", None)
        if getattr(handler, "__module__", "") != plugin.__name__ or getattr(handler, "__name__", "") != f"timely_{name}":
            problems.append(f"{name} is not timely_tools' handler")
    return problems, have

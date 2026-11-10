"""Runtime dump of the Hermes copy for `make hermes-sync-check` (plan 10.4 d and e).

Runs inside the agent interpreter (apps/agent/.venv), never the system Python:
  apps/agent/.venv/bin/python -I -B scripts/hermes-sync/check_dump.py --out <file.json>

It is also the import smoke test (10.4 d): it imports the Hermes modules the worker uses with a
fresh HERMES_HOME, HERMES_RUNTIME_DIR and HOME under $HOME/.cache/timely-agent-test (or
TIMELY_AGENT_TEST_DIR), enables every bundled plugin in that throwaway home so plugin tools
register, and writes JSON:

  tools    {name: {toolset, owner, module, schema_sha256}} from the live tool registry; owner is
           `core`, `plugin:<plugin key>` or `mcp:<server>`
  inline   tool names the model can call that are not registry entries (Tool Search bridge,
           Bot Mode's message_agent) and the agent-loop tools model_tools refuses to dispatch
  skills   bundled skill names Hermes' own skills_sync discovers, with their folders
  plugins  {plugin key: [tools it registered]}

The environment is cleared to a short allowlist first, so no provider key or platform token is
visible, and nothing is ever read from or written to ~/.hermes. Hermes output printed during
import goes to stderr; only --out holds the JSON.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import traceback

KEEP_ENV = {"PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR",
            "COMSPEC", "PATHEXT", "SYSTEMDRIVE"}
SMOKE_IMPORTS = [
    "run_agent", "model_tools", "toolsets", "hermes_state", "hermes_constants",
    "hermes_cli.plugins", "hermes_cli.config", "hermes_cli.managed_scope",
    "tools.registry", "tools.approval", "tools.write_approval", "tools.skill_ledger", "tools.skills_sync",
    "tools.skill_manager_tool", "tools.threat_patterns", "tools.url_safety",
    "agent.agent_init_params", "agent.conversation_loop", "agent.background_review", "agent.curator",
    "agent.skill_utils", "agent.tool_dispatch_helpers", "gateway.session_context", "cron.jobs",
    "acp_adapter",
]


def schema_sha256(schema):
    """Same as check_lib.schema_sha256 (this file runs in the agent interpreter, apart from it)."""
    blob = json.dumps(schema, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def fresh_env(base):
    """Clear the environment to KEEP_ENV and point every home Hermes might use at temp folders."""
    real_hermes = os.path.realpath(os.path.join(os.path.expanduser("~"), ".hermes"))
    os.makedirs(base, exist_ok=True)
    root = tempfile.mkdtemp(prefix="dump.", dir=base)
    if os.path.realpath(root).startswith(real_hermes + os.sep) or os.path.realpath(root) == real_hermes:
        raise SystemExit("check_dump: refusing a temp dir inside ~/.hermes")
    dirs = {name: os.path.join(root, name) for name in ("home", "runtime", "user", "xdg")}
    for d in dirs.values():
        os.makedirs(d)
    for key in list(os.environ):
        if key.upper() not in KEEP_ENV:
            del os.environ[key]
    os.environ.update({
        "HERMES_HOME": dirs["home"], "HERMES_RUNTIME_DIR": dirs["runtime"],
        "HOME": dirs["user"], "USERPROFILE": dirs["user"],
        "XDG_CONFIG_HOME": os.path.join(dirs["xdg"], "config"), "XDG_CACHE_HOME": os.path.join(dirs["xdg"], "cache"),
        "XDG_DATA_HOME": os.path.join(dirs["xdg"], "data"), "XDG_STATE_HOME": os.path.join(dirs["xdg"], "state"),
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    return root, dirs


def bundled_plugin_keys(hermes_dir):
    """Every manifest key under the copy's plugins/ folder, via Hermes' own scanner."""
    from hermes_cli.plugins_discovery import manifest_key, scan_directory
    return sorted({manifest_key(m) for m in scan_directory(__import__("pathlib").Path(hermes_dir, "plugins"), "bundled")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--hermes", default=None, help="the copy (default apps/agent/hermes next to this repo)")
    ap.add_argument("--base", default=None, help="parent of the throwaway homes")
    ap.add_argument("--keep", action="store_true", help="keep the throwaway home for debugging")
    a = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    hermes_dir = os.path.abspath(a.hermes or os.path.join(repo, "apps", "agent", "hermes"))
    agent_dir = os.path.dirname(hermes_dir)
    out_path = os.path.abspath(a.out)
    base = a.base or os.environ.get("TIMELY_AGENT_TEST_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "timely-agent-test")
    root, dirs = fresh_env(base)
    sys.dont_write_bytecode = True
    # boot.py's layout: the copy first, then apps/agent (for timely_agent), never this script's folder.
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [hermes_dir, agent_dir] + [p for p in sys.path if p and os.path.abspath(p) != here]
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    result = {"python": sys.version.split()[0], "errors": []}
    try:
        keys = bundled_plugin_keys(hermes_dir)
        with open(os.path.join(dirs["home"], "config.yaml"), "w", encoding="utf-8") as fh:
            fh.write("display:\n  language: en\nplugins:\n  enabled:\n")
            fh.writelines(f"    - {json.dumps(k)}\n" for k in keys)
        import importlib
        for mod in SMOKE_IMPORTS:
            try:
                importlib.import_module(mod)
            except Exception as exc:  # report every failing import, not just the first
                result["errors"].append(f"import {mod}: {type(exc).__name__}: {exc}")
        if os.path.isdir(os.path.join(agent_dir, "timely_agent")):
            try:
                importlib.import_module("timely_agent")
            except Exception as exc:
                result["errors"].append(f"import timely_agent: {type(exc).__name__}: {exc}")
        try:
            from run_agent import AIAgent  # noqa: F401  (the worker's entry point must import)
        except Exception as exc:
            result["errors"].append(f"from run_agent import AIAgent: {type(exc).__name__}: {exc}")

        import model_tools
        from hermes_cli import plugins as plugin_mod
        from tools.registry import registry
        manager = plugin_mod.get_plugin_manager()
        by_plugin = {}
        for key, loaded in sorted(manager._plugins.items()):
            if loaded.error:
                result["errors"].append(f"plugin {key}: {loaded.error}")
            for tool in loaded.tools_registered or ():
                by_plugin.setdefault(key, []).append(tool)
        owner_of = {tool: f"plugin:{key}" for key, tools in by_plugin.items() for tool in tools}
        tools = {}
        for entry in registry.get_all_entries():
            if entry.toolset.startswith("mcp-"):
                owner = "mcp:" + entry.toolset[len("mcp-"):]
            elif entry.name in owner_of:
                owner = owner_of[entry.name]
            else:
                ns = registry._plugin_owner_of(entry.handler)
                owner = f"plugin:?{ns}" if ns else "core"
            tools[entry.name] = {"toolset": entry.toolset, "owner": owner,
                                 "module": registry._callable_module(entry.handler),
                                 "schema_sha256": schema_sha256(entry.schema)}
        result["tools"] = dict(sorted(tools.items()))
        result["plugins"] = {k: sorted(v) for k, v in sorted(by_plugin.items())}
        result["plugins_enabled"] = keys

        from tools.bot_mode_dm import MESSAGE_AGENT_TOOL_NAME, message_agent_tool_schema
        from tools.tool_search_catalog import BRIDGE_TOOL_NAMES
        result["inline"] = {
            "bridge": sorted(BRIDGE_TOOL_NAMES),
            "message_agent": {"name": MESSAGE_AGENT_TOOL_NAME,
                              "schema_sha256": schema_sha256(message_agent_tool_schema())},
            "agent_loop": sorted(model_tools._AGENT_LOOP_TOOLS),
        }

        from pathlib import Path
        from tools.skills_sync import _discover_bundled_skills
        bundled = Path(hermes_dir, "skills")
        result["skills"] = {name: d.relative_to(Path(hermes_dir)).as_posix()
                            for name, d in sorted(_discover_bundled_skills(bundled))}
    except Exception:
        result["errors"].append("dump failed:\n" + traceback.format_exc())
    finally:
        sys.stdout = real_stdout
        if not a.keep:
            shutil.rmtree(root, ignore_errors=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1, sort_keys=True)
    if a.keep:
        print(f"check_dump: kept {root}", file=sys.stderr)
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())

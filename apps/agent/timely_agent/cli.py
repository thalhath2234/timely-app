"""``boot.py prepare`` and ``boot.py render-account``: the steps Go runs before it spawns workers.

Both read an optional JSON object on stdin and print one JSON object on stdout (exit 0), or
``{"ok": false, "error": ...}`` (exit 1). See ``apps/agent/PROTOCOL.md`` "Before spawning".

- ``prepare --agent-dir <data>/agent`` (API start): folders of section 6.1, ``instance.json``
  (layout version only; Go adds its own fields), the read-only Timely skills copy and the seed
  tree (section 9.1), ``managed/config.yaml`` (section 6.3) read back through Hermes as a
  canary, and ``runtime/prepared.json`` with the paths ``render-account`` and the worker reuse.
  Input: ``{"browser_executable": "..."}`` (optional).
- ``render-account --agent-dir <data>/agent --account <uid>`` (before each spawn): the account
  home, ``config.yaml`` and ``SOUL.md``. Input: the account settings JSON. Output includes
  ``config_sha256`` (send it as ``hello.settings_hash``) and ``env``, the worker environment
  values Go merges into its allowlist.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from timely_agent import config_render, env_check, paths, seed

PREPARED = "prepared.json"


def _read_stdin_json() -> dict[str, Any]:
    if sys.stdin is None or sys.stdin.isatty():
        return {}
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("stdin must hold a JSON object")
    return data


def prepared_file(layout: paths.AgentLayout) -> Path:
    return layout.runtime_dir / PREPARED


def load_prepared(layout: paths.AgentLayout) -> dict[str, Any]:
    p = prepared_file(layout)
    if not p.is_file():
        raise FileNotFoundError(f"{p} is missing: run `boot.py prepare --agent-dir {layout.root}` first")
    return json.loads(p.read_text(encoding="utf-8"))


def _write_instance(layout: paths.AgentLayout) -> None:
    data: dict[str, Any] = {}
    if layout.instance_file.is_file():
        try:
            data = json.loads(layout.instance_file.read_text(encoding="utf-8"))
        except ValueError:
            data = {}
    existing = data.get("layout_version")
    if isinstance(existing, int) and existing > paths.LAYOUT_VERSION:
        raise RuntimeError(f"agent folder layout {existing} is newer than this Timely ({paths.LAYOUT_VERSION})")
    data["layout_version"] = paths.LAYOUT_VERSION
    config_render.write_atomic(layout.instance_file, (json.dumps(data, indent=2, sort_keys=True) + "\n").encode(),
                               mode=0o644)


def _isolate_for_hermes(layout: paths.AgentLayout) -> Path:
    """Point Hermes at a throwaway home inside the agent folder before importing it, so the
    canary never reads or writes the user's own ``~/.hermes``."""
    home = layout.runtime_dir / "prepare-home"
    (home / "home").mkdir(parents=True, exist_ok=True)
    os.environ.update({
        "HERMES_HOME": str(home), "HOME": str(home / "home"),
        "HERMES_MANAGED_DIR": str(layout.managed_dir), "HERMES_RUNTIME_DIR": str(layout.runtime_dir),
        "HERMES_GATEWAY_LOCK_DIR": str(layout.locks_dir), "XDG_STATE_HOME": str(layout.locks_dir / "state"),
    })
    for name in env_check.FORBIDDEN:
        os.environ.pop(name, None)
    return home


def prepare(layout: paths.AgentLayout, opts: dict[str, Any]) -> dict[str, Any]:
    layout.ensure()
    _write_instance(layout)
    browser = str(opts.get("browser_executable") or "")
    timely_skills = seed.build_timely_skills(layout, opts.get("timely_skills_src") or paths.timely_skills_src())
    reviewed = seed.load_reviewed(opts.get("skills_reviewed") or paths.skills_reviewed_file())
    src = Path(opts.get("timely_skills_src") or paths.timely_skills_src())
    seed_dir, report = seed.build_seed_tree(
        layout, upstream=opts.get("upstream_skills") or paths.hermes_dir() / "skills",
        overrides=src / "overrides", reviewed=reviewed)
    managed_path, managed_sha = config_render.render_managed(
        layout, timely_skills_dir=timely_skills, browser_executable=browser)
    canary_home = _isolate_for_hermes(layout)
    cfg, _ = config_render.account_config({}, timely_skills_dir=timely_skills, browser_executable=browser)
    config_render.write_atomic(canary_home / "config.yaml", config_render.dumps(cfg))
    from timely_agent import install_guard
    install_guard.install()
    problems = config_render.canary(timely_skills, browser, managed_sha)
    if problems:
        raise RuntimeError("managed config canary failed: " + "; ".join(problems))
    state = {
        "agent_dir": str(layout.root),
        "managed_config": str(managed_path),
        "managed_sha256": managed_sha,
        "timely_skills_dir": str(timely_skills),
        "seed_skills_dir": str(seed_dir),
        "browser_executable": browser,
        "skills_reviewed_found": reviewed is not None,
        "skills_default_off": sorted(set(report["default_off"])),
    }
    config_render.write_atomic(prepared_file(layout), (json.dumps(state, indent=2, sort_keys=True) + "\n").encode(),
                               mode=0o644)
    return {
        "ok": True, **state,
        "seed": {k: len(v) for k, v in report.items()},
        "env": {
            "HERMES_MANAGED_DIR": str(layout.managed_dir),
            "HERMES_RUNTIME_DIR": str(layout.runtime_dir),
            "HERMES_GATEWAY_LOCK_DIR": str(layout.locks_dir),
            "XDG_STATE_HOME": str(layout.locks_dir / "state"),
            "HERMES_BUNDLED_SKILLS": str(seed_dir),
        },
    }


def render_account(layout: paths.AgentLayout, account: str, settings: dict[str, Any],
                   prepared: dict[str, Any] | None = None) -> dict[str, Any]:
    """``prepared`` replaces ``runtime/prepared.json`` (the worker passes the values Go sent in
    ``hello`` over the file's)."""
    state = prepared if prepared is not None else load_prepared(layout)
    # Reviewed bundled skills that are off by default stay off unless the person turned them on.
    enabled = {str(s) for s in settings.get("skills_enabled") or []}
    default_off = [n for n in state.get("skills_default_off") or [] if n not in enabled]
    settings = {**settings, "skills_disabled": sorted({*(settings.get("skills_disabled") or []), *default_off})}
    out = config_render.render_account(
        layout, account, settings, timely_skills_dir=state["timely_skills_dir"],
        browser_executable=state.get("browser_executable", ""))
    env = env_check.build_env(layout, account, seed_skills=state["seed_skills_dir"], base={})
    for name in ("PATH", "LANG", "TZ", "TMPDIR", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
                 "HERMES_REAL_HOME"):
        env.pop(name, None)  # Go supplies these from its own process
    return {"ok": True, "account_dir": paths.account_dir_name(account), **out, "env": env}


def main(command: str, argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=f"boot.py {command}")
    parser.add_argument("--agent-dir", required=True, help="<TIMELY_DATA_DIR>/agent")
    if command == "render-account":
        parser.add_argument("--account", required=True, help="the account (user) id")
    args = parser.parse_args(argv)
    layout = paths.AgentLayout.at(args.agent_dir)
    out, sys.stdout = sys.stdout, sys.stderr  # Hermes imports may print; stdout carries one JSON line
    try:
        opts = _read_stdin_json()
        result = prepare(layout, opts) if command == "prepare" else render_account(layout, args.account, opts)
    except Exception as exc:  # one JSON answer either way; the traceback goes to stderr
        import traceback
        traceback.print_exc(file=sys.stderr)
        out.write(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}) + "\n")
        out.flush()
        return 1
    out.write(json.dumps(result, sort_keys=True) + "\n")
    out.flush()
    return 0

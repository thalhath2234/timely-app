"""``boot.py prepare``, ``render-account`` and the agent-state helpers: the steps Go runs around workers.

Both read an optional JSON object on stdin and print one JSON object on stdout (exit 0), or
``{"ok": false, "error": ...}`` (exit 1). See ``apps/agent/PROTOCOL.md`` "Before spawning".

- ``prepare --agent-dir <data>/agent`` (API start): folders of section 6.1, ``instance.json``
  (layout version only; Go adds its own fields), the read-only Timely skills copy and the seed
  tree (section 9.1), ``managed/config.yaml`` (section 6.3) read back through Hermes as a
  canary, and ``runtime/prepared.json``, a copy of the answer for people reading the folder
  (nothing reads it back: its values are policy, and the file is writable).
  Input: ``{"browser_executable": "..."}`` (optional).
- ``render-account --agent-dir <data>/agent --account <uid> --prepared <json>`` (before each
  spawn): the account home, ``config.yaml`` and ``SOUL.md``. Input: the account settings JSON;
  ``--prepared`` is prepare's answer as Go keeps it in memory (``timely_skills_dir``,
  ``seed_skills_dir``, ``browser_executable``, ``skills_default_off``), never read back from
  ``runtime/prepared.json``, which sits in the writable agent folder. Output includes
  ``config_sha256`` (send it as ``hello.settings_hash``) and ``env``, the worker environment
  values Go merges into its allowlist.
- ``agent-export --agent-dir <root> --account <uid> --out <zip>``, ``agent-import --agent-dir <root>
  --account <uid> --zip <zip>`` and ``agent-reconcile --agent-dir <root>``: an account's agent
  state in a backup (``timely_agent.backup``; PROTOCOL.md section 10.8). ``prepare`` runs the
  reconcile too, so a restore that crashed between staging and the swap is finished or dropped.
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import sys
from pathlib import Path
from typing import Any

from timely_agent import backup, config_render, env_check, paths, seed

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


PREPARED_KEYS = ("timely_skills_dir", "seed_skills_dir", "browser_executable", "skills_default_off")


def parse_prepared(raw: str) -> dict[str, Any]:
    """``render-account --prepared``: prepare's answer as Go holds it. Every key is required, so a
    caller that forgot one fails here instead of rendering without the default-off skills."""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("--prepared must be a JSON object")
    missing = [k for k in PREPARED_KEYS if k not in data]
    if missing:
        raise ValueError(f"--prepared lacks {', '.join(missing)}")
    for k in ("timely_skills_dir", "seed_skills_dir", "browser_executable"):
        if not isinstance(data[k], str):
            raise ValueError(f"--prepared {k} must be a string")
    if not data["timely_skills_dir"]:
        raise ValueError("--prepared timely_skills_dir is empty")
    off = data["skills_default_off"]
    if not isinstance(off, list) or any(not isinstance(n, str) for n in off):
        raise ValueError("--prepared skills_default_off must be a list of names")
    return {k: data[k] for k in PREPARED_KEYS}


def effective_default_off(default_off: list[str], settings: dict[str, Any]) -> list[str]:
    """Reviewed bundled skills that are off by default stay off unless the person turned them on."""
    enabled = {str(s) for s in settings.get("skills_enabled") or []}
    return sorted({str(n) for n in default_off} - enabled)


@functools.lru_cache(maxsize=8)
def denied_skill_names(seed_dir: str = "") -> tuple[str, ...]:
    """The denied bundled skills (Hermes-self, or needing a tool Timely never offers), always off:
    a home seeded before they were denied keeps its copies. A skill the seed tree holds is not
    among them (a Timely override replaces the upstream one and is seeded). Nothing when the
    policy file is absent."""
    try:
        denied = seed.load_denied(seed.denied_file_for(paths.skills_reviewed_file()))
        names = seed.denied_bundled_names(denied, paths.hermes_dir() / "skills")
        seeded: set[str] = set()
        if seed_dir and Path(seed_dir).is_dir():
            for d in seed.skill_dirs(Path(seed_dir)):
                seeded |= seed.skill_names(d)
        return tuple(n for n in names if n not in seeded)
    except (OSError, ValueError):
        return ()


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
    restores = backup.reconcile(layout)
    browser = str(opts.get("browser_executable") or "")
    timely_skills = seed.build_timely_skills(layout, opts.get("timely_skills_src") or paths.timely_skills_src())
    reviewed_file = opts.get("skills_reviewed") or paths.skills_reviewed_file()
    reviewed = seed.load_reviewed(reviewed_file)
    denied = seed.load_denied(opts.get("skills_denied") or seed.denied_file_for(reviewed_file))
    src = Path(opts.get("timely_skills_src") or paths.timely_skills_src())
    seed_dir, report = seed.build_seed_tree(
        layout, upstream=opts.get("upstream_skills") or paths.hermes_dir() / "skills",
        overrides=src / "overrides", reviewed=reviewed, denied=denied)
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
        "skills_denied_found": denied is not None,
        "skills_default_off": sorted(set(report["default_off"])),
    }
    config_render.write_atomic(prepared_file(layout), (json.dumps(state, indent=2, sort_keys=True) + "\n").encode(),
                               mode=0o644)
    return {
        "ok": True, **state,
        "seed": {k: len(v) for k, v in report.items()},
        "restores": {k: v for k, v in restores.items() if k != "ok"},
        "env": {
            "HERMES_MANAGED_DIR": str(layout.managed_dir),
            "HERMES_RUNTIME_DIR": str(layout.runtime_dir),
            "HERMES_GATEWAY_LOCK_DIR": str(layout.locks_dir),
            "XDG_STATE_HOME": str(layout.locks_dir / "state"),
            "HERMES_BUNDLED_SKILLS": str(seed_dir),
        },
    }


def render_account(layout: paths.AgentLayout, account: str, settings: dict[str, Any],
                   prepared: dict[str, Any]) -> dict[str, Any]:
    """``prepared`` is prepare's answer from Go: ``--prepared`` on the command line, or the
    values ``hello`` carries in the worker. Never ``runtime/prepared.json``."""
    state = prepared
    default_off = effective_default_off(state["skills_default_off"], settings)
    settings = {**settings, "skills_disabled": sorted({*(settings.get("skills_disabled") or []), *default_off,
                                                       *denied_skill_names(str(state.get("seed_skills_dir") or ""))})}
    out = config_render.render_account(
        layout, account, settings, timely_skills_dir=state["timely_skills_dir"],
        browser_executable=state.get("browser_executable", ""))
    env = env_check.build_env(layout, account, seed_skills=state["seed_skills_dir"], base={})
    for name in ("PATH", "LANG", "TZ", "TMPDIR", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
                 "HERMES_REAL_HOME"):
        env.pop(name, None)  # Go supplies these from its own process
    return {"ok": True, "account_dir": paths.account_dir_name(account), **out, "env": env}


STATE_COMMANDS = ("agent-export", "agent-import", "agent-reconcile")
COMMANDS = ("prepare", "render-account", *STATE_COMMANDS)


def agent_state(command: str, layout: paths.AgentLayout, args: argparse.Namespace) -> dict[str, Any]:
    """The agent-state helpers. Export and import read Hermes (its backup walker, SQLite snapshot
    and threat scan), so Hermes is pointed at a throwaway home first, as for prepare's canary."""
    if command == "agent-reconcile":
        return backup.reconcile(layout)
    if not layout.instance_file.is_file():
        raise backup.BackupError(f"{layout.root} has no instance.json; run prepare first")
    _isolate_for_hermes(layout)
    if command == "agent-export":
        return backup.export_state(layout, args.account, Path(args.out))
    return backup.import_state(layout, args.account, Path(args.zip))


def main(command: str, argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=f"boot.py {command}")
    parser.add_argument("--agent-dir", required=True, help="<TIMELY_DATA_DIR>/agent")
    if command in ("render-account", "agent-export", "agent-import"):
        parser.add_argument("--account", required=True, help="the account (user) id")
    if command == "render-account":
        parser.add_argument("--prepared", required=True,
                            help="prepare's answer as JSON (" + ", ".join(PREPARED_KEYS) + ")")
    if command == "agent-export":
        parser.add_argument("--out", required=True, help="the zip to write")
    if command == "agent-import":
        parser.add_argument("--zip", required=True, help="the zip agent-export wrote")
    args = parser.parse_args(argv)
    layout = paths.AgentLayout.at(args.agent_dir)
    out, sys.stdout = sys.stdout, sys.stderr  # Hermes imports may print; stdout carries one JSON line
    try:
        if command in STATE_COMMANDS:
            result = agent_state(command, layout, args)
        elif command == "prepare":
            result = prepare(layout, _read_stdin_json())
        else:
            result = render_account(layout, args.account, _read_stdin_json(), parse_prepared(args.prepared))
    except Exception as exc:  # one JSON answer either way; the traceback goes to stderr
        import traceback
        traceback.print_exc(file=sys.stderr)
        out.write(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}) + "\n")
        out.flush()
        return 1
    out.write(json.dumps(result, sort_keys=True) + "\n")
    out.flush()
    return 0

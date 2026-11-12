"""Stdlib-level units: protocol framing, paths, environment rules, config rendering, seed tree."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import threading
from pathlib import Path

import pytest

import harness
from timely_agent import config_render, env_check, paths, policy, protocol as P, seed

HERMES_SKILLS = paths.hermes_dir() / "skills"


# ---------------------------------------------------------------- protocol

def test_decode_checks_type_and_account():
    msg = P.decode(b'{"type":"run.stop","id":"1","account":"a","run_id":"r"}', "a")
    assert msg["run_id"] == "r"
    with pytest.raises(P.ProtocolError) as e:
        P.decode(b'{"type":"run.stop","id":"1","account":"b"}', "a")
    assert e.value.code == P.E_WRONG_ACCOUNT and e.value.msg_id == "1"
    for line, code in [(b"not json", P.E_BAD_JSON), (b"[1]", P.E_BAD_MESSAGE),
                       (b'{"account":"a"}', P.E_BAD_MESSAGE), (b'{"type":"ready","account":"a"}', P.E_UNKNOWN_TYPE),
                       (b'{"type":"hello"}', P.E_BAD_MESSAGE)]:
        with pytest.raises(P.ProtocolError) as e:
            P.decode(line, None)
        assert e.value.code == code
    assert P.decode(b'{"type":"learning.list","account":"x"}', None)["type"] == "learning.list"


def test_encode_is_one_line():
    data = P.encode({"type": "event", "payload": {"text": "a\nb"}})
    assert data.endswith(b"\n") and data.count(b"\n") == 1
    assert json.loads(data)["payload"]["text"] == "a\nb"


def test_encode_survives_a_lone_surrogate():
    # a streamed delta split inside an emoji: "half \ud83d"
    data = P.encode({"type": "event", "payload": {"text": "half \ud83d", "name": "caf\u00e9"}})
    assert data.isascii() and data.count(b"\n") == 1
    assert json.loads(data)["payload"]["name"] == "caf\u00e9"


def _strict(data: bytes):
    def refuse(token):
        raise ValueError(f"non-standard JSON token {token}")
    return json.loads(data, parse_constant=refuse)


def test_encode_never_writes_nan_or_infinity():
    """Go's encoding/json refuses NaN/Infinity, and a refused line kills the account's worker.
    Model-made tool arguments can hold them (Hermes parses arguments with json.loads)."""
    nan, inf = float("nan"), float("inf")
    data = P.encode({"type": "event", "payload": {"args": {"merge": nan, "n": [1.5, -inf, {"x": inf}],
                                                            "t": (nan,)}, "ok": 2.0}})
    msg = _strict(data)
    assert msg["payload"] == {"args": {"merge": None, "n": [1.5, None, {"x": None}], "t": [None]}, "ok": 2.0}


def test_pending_requests_round_trip():
    pending = P.PendingRequests()
    sent = []

    def send(msg):
        sent.append(msg)
        threading.Timer(0.05, lambda: pending.resolve({"type": "gate.verdict", "id": msg["id"], "verdict": "allow"})).start()
        return True

    reply = pending.ask(send, {"type": "gate.ask"}, timeout=5)
    assert reply["verdict"] == "allow" and sent[0]["id"] == reply["id"]
    assert pending.ask(lambda m: True, {"type": "gate.ask"}, timeout=0.05) is None
    assert pending.ask(lambda m: False, {"type": "gate.ask"}, timeout=5) is None


class _FakeAgent:
    def __init__(self):
        self.interrupted = False
        self.steers = []

    def interrupt(self, reason, hard_cancel=False):
        self.interrupted = True

    def clear_interrupt(self, hard_cancel=False):
        self.interrupted = False

    def steer(self, text):
        self.steers.append(text)
        return True


def test_run_stop_never_reaches_the_cached_agent_after_the_run_finished():
    """The conversation's agent outlives the run: a stop or steer after finish() must not touch
    it, and a stop that landed before finish() (Hermes had already cleared its interrupt, or the
    turn returned early) is cleared, so the next turn is not read as stopped."""
    from timely_agent.run_chat import Run
    agent = _FakeAgent()
    run = Run(run_id="r", request_id="s", msg={})
    run.stop("user")  # before the agent is attached: recorded only
    assert run.stop_reason == "user" and not agent.interrupted
    run.attach(agent)
    run.stop("user")  # lands, then the turn returns early (run_turn's stop_reason check)
    assert agent.interrupted
    run.finish()
    assert not agent.interrupted and run.finished
    run.stop("user again")  # late: after the turn, before the run left the worker's table
    assert not agent.interrupted and run.stop_reason == "user again"
    assert run.steer("late note") is False and agent.steers == []

    clean = _FakeAgent()
    run2 = Run(run_id="r2", request_id="s2", msg={})
    run2.attach(clean)
    assert run2.steer("in time") is True and clean.steers == ["in time"]
    clean.interrupted = True  # finish() leaves an agent alone when this run was never stopped
    run2.finish()
    assert clean.interrupted


# ---------------------------------------------------------------- paths

def test_account_dir_matches_go_portability_name():
    # portability/service.go: fmt.Sprintf("account-%x", sha256.Sum256([]byte(userID))[:12])
    uid = "3f1c0b8e-2a44-4c1e-9d55-0a9b7f6c1e22"
    want = "account-" + hashlib.sha256(uid.encode()).hexdigest()[:24]
    assert paths.account_dir_name(uid) == want
    with pytest.raises(ValueError):
        paths.account_dir_name("")


def test_layout_creates_section_6_1_folders(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    layout.ensure()
    home = layout.ensure_home("u1")
    assert home.parent == layout.accounts_dir and home.parent.name == "accounts"
    for name in paths.HOME_DIRS:
        assert (home / name).is_dir()
    for d in (layout.managed_dir, layout.runtime_dir, layout.locks_dir):
        assert d.is_dir()
    assert paths.layout_for_home(home).root == layout.root


# ---------------------------------------------------------------- environment

def _good_env(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    layout.ensure()
    layout.ensure_home("u1")
    return layout, env_check.build_env(layout, "u1", base={"PATH": "/usr/bin"})


def test_reference_env_passes(tmp_path):
    _, env = _good_env(tmp_path)
    problems, warnings = env_check.check(env, strict_unknown=True)
    assert problems == [] and warnings == []


@pytest.mark.parametrize("name", ["JWT_SECRET", "DB_PASSWORD", "TIMELY_BACKUP_KEY", "API_PORT", "HERMES_YOLO",
                                  "HERMES_SAFE_MODE", "HERMES_CRON_SESSION", "HERMES_ENABLE_PROJECT_PLUGINS",
                                  "HERMES_CONFIG_BACKEND", "HERMES_LANGUAGE", "HERMES_BUNDLED_LOCALES",
                                  "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "PYTHONPATH", "HERMES_YOLO_MODE",
                                  "HERMES_ALLOW_PRIVATE_URLS", "HERMES_ACP_AUTO_APPROVE", "HERMES_SOMETHING_NEW",
                                  "YUANBAO_APP_SECRET", "A2A_BEARER_TOKEN", "NTFY_TOKEN", "IRC_NICKSERV_PASSWORD",
                                  "SIMPLEX_WS_URL", "BUZZ_PRIVATE_KEY", "RAFT_PROFILE",
                                  "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON", "QQBOT_HOME_CHANNEL", "SMS_ALLOWED_USERS"])
def test_forbidden_env_is_refused(tmp_path, name):
    _, env = _good_env(tmp_path)
    env[name] = "x"
    problems, _ = env_check.check(env)
    assert any(name in p for p in problems)


def test_dotenv_files_set_aside_and_drift(tmp_path):
    home, hermes, managed = tmp_path / "home", tmp_path / "hermes", tmp_path / "managed"
    for d in (home, hermes, managed):
        d.mkdir()
    assert env_check.dotenv_files(home, hermes, managed) == []
    (home / ".env").write_text("HERMES_YOLO_MODE=1\n")
    (home / ".op.env").write_text("X=1\n")
    (home / ".env.timely-disabled").write_text("old\n")
    (hermes / ".env").write_text("Y=1\n")
    assert len(env_check.dotenv_files(home, hermes, managed)) == 3
    moved = env_check.set_aside_home_dotenv(home)
    assert sorted(p.name for p in moved) == [".env", ".op.env"]
    assert (home / ".env.timely-disabled").read_text() == "HERMES_YOLO_MODE=1\n"
    assert env_check.dotenv_files(home, hermes, managed) == [hermes / ".env"]
    before = {"A": "1", "B": "2", "TERMINAL_ENV": "local"}
    after = {"A": "1", "B": "3", "C": "4", "TERMINAL_ENV": "local", "TERMINAL_X": "y"}
    assert env_check.drift(before, after, ignore={"TERMINAL_X"}) == ["B changed", "C added"]
    assert env_check.drift(after, before) == ["B changed", "C added".replace("added", "removed"),
                                               "TERMINAL_X removed"]


def test_env_home_rules(tmp_path):
    layout, env = _good_env(tmp_path)
    for missing in env_check.REQUIRED:
        e = dict(env)
        e.pop(missing)
        assert any(missing in p for p in env_check.check(e)[0])
    e = dict(env, HOME=str(tmp_path))
    assert any("HOME must be" in p for p in env_check.check(e)[0])
    e = dict(env, HERMES_HOME=str(tmp_path / "profiles" / "x"))
    assert any("accounts" in p for p in env_check.check(e)[0])
    real = tmp_path / "realhome"
    (real / ".hermes" / "accounts" / "x").mkdir(parents=True)
    e = dict(env, HERMES_HOME=str(real / ".hermes" / "accounts" / "x"), HERMES_REAL_HOME=str(real))
    os.environ["HERMES_REAL_HOME"] = str(real)
    try:
        assert any("~/.hermes" in p for p in env_check.check(e)[0])
    finally:
        os.environ.pop("HERMES_REAL_HOME", None)


# ---------------------------------------------------------------- config render

def test_managed_floors_hold_plan_6_3_values(tmp_path):
    f = config_render.managed_floors(timely_skills_dir=tmp_path, browser_executable="/usr/bin/chromium")
    assert f["plugins"]["enabled"] == list(config_render.TIMELY_PLUGINS)
    assert f["plugins"]["entries"] == {"timely_bot": {"allow_tool_override": True}}
    assert f["security"]["allow_private_urls"] is False and f["security"]["fake_ip_ranges"] == []
    assert f["security"]["allow_lazy_installs"] is False
    assert f["skills"]["external_dirs"] == [str(tmp_path)]
    assert f["skills"]["inline_shell"] is False and f["skills"]["guard_agent_created"] is True
    assert f["approvals"]["mode"] == "manual" and f["approvals"]["cron_mode"] == "deny"
    assert f["approvals"]["unattended_mode"] == "deny"
    assert f["telemetry"]["shared_metrics"]["enabled"] is False
    assert f["web"] == {"keyless_fallback": False, "keyless_rescue": False}
    assert f["memory"]["provider"] == "" and f["display"]["language"] == "en"
    assert f["browser"]["executable_path"] == "/usr/bin/chromium"
    assert "cronjob" in f["agent"]["disabled_toolsets"]
    assert f["tools"]["tool_search"]["enabled"] == "off"


def test_account_config_repeats_floors_and_filters(tmp_path):
    cfg, dropped = config_render.account_config(
        {"toolsets": ["todo", "kanban", "discord"], "skills_disabled": ["b", "a"], "timezone": "Asia/Tokyo",
         "mcp_servers": {"good": {"url": "https://mcp.example.com/sse"}, "cgnat": {"url": "http://100.64.0.1/mcp"},
                         "loop": {"url": "http://127.0.0.1:9/mcp"}, "local": {"url": "http://localhost/mcp"},
                         "shell": {"command": "npx", "args": ["x"]}}},
        timely_skills_dir=tmp_path)
    assert cfg["toolsets"] == ["todo"]
    assert cfg["skills"]["disabled"] == ["a", "b"] and cfg["skills"]["external_dirs"] == [str(tmp_path)]
    assert cfg["plugins"]["enabled"] == list(config_render.TIMELY_PLUGINS)
    assert set(cfg["mcp_servers"]) == {"good"}
    assert len(dropped) == 4 and any("host-allowed" in d for d in dropped)
    assert cfg["timezone"] == "Asia/Tokyo"


def test_command_mcp_needs_host_and_approval(tmp_path):
    entry = {"command": "uvx", "args": ["mcp-thing"], "env": ["THING_KEY"]}
    servers = {"s": entry}
    kept, _ = config_render.filter_mcp_servers(servers, host_allowed=True, approved_hashes=[])
    assert kept == {}
    kept, _ = config_render.filter_mcp_servers(servers, host_allowed=True,
                                               approved_hashes=[config_render.mcp_entry_hash(entry)])
    assert kept == {"s": entry}
    kept, _ = config_render.filter_mcp_servers(servers, host_allowed=False,
                                               approved_hashes=[config_render.mcp_entry_hash(entry)])
    assert kept == {}


def test_render_account_writes_home_and_stable_hash(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    a = config_render.render_account(layout, "u1", {"timezone": "UTC"}, timely_skills_dir=tmp_path)
    b = config_render.render_account(layout, "u1", {"timezone": "UTC"}, timely_skills_dir=tmp_path)
    home = Path(a["home"])
    assert a["config_sha256"] == b["config_sha256"] == config_render.sha256_file(home / "config.yaml")
    assert (home / "SOUL.md").read_text().startswith("You are Timely")
    state = json.loads((home / config_render.ACCOUNT_STATE).read_text())
    assert state["host_allowed"] is False and state["config_sha256"] == a["config_sha256"]
    if os.name == "posix":
        assert stat.S_IMODE((home / "config.yaml").stat().st_mode) == 0o600


def test_denied_bundled_skills_are_always_off(tmp_path):
    """A home seeded before a skill was denied keeps its copy (Hermes' sync keeps a dropped
    built-in on disk): render_account lists every denied bundled skill in skills.disabled."""
    from timely_agent import cli
    names = cli.denied_skill_names()
    assert {"hermes-agent", "claude-code", "codex", "github"} <= set(names), names
    layout = paths.AgentLayout.at(tmp_path / "agent")
    out = cli.render_account(layout, "u1", {"skills_disabled": ["mine"]},
                             {"timely_skills_dir": str(tmp_path), "seed_skills_dir": str(tmp_path),
                              "browser_executable": "", "skills_default_off": []})
    text = (Path(out["home"]) / "config.yaml").read_text()
    disabled = json.loads(text[text.index("{"):])["skills"]["disabled"]
    assert {"hermes-agent", "github", "mine"} <= set(disabled), disabled
    # a denied skill Timely overrides is seeded (the override wins) and stays loadable
    seeded = tmp_path / "seed" / "productivity" / "product-price-monitor"
    seeded.mkdir(parents=True)
    (seeded / "SKILL.md").write_text("---\nname: product-price-monitor\ndescription: x\n---\nTimely's.\n")
    assert "product-price-monitor" in names
    assert "product-price-monitor" not in cli.denied_skill_names(str(tmp_path / "seed"))


# ---------------------------------------------------------------- policy

def test_messaging_and_blocked_names():
    for name in ("discord", "send_message", "a2a_call", "feishu_doc_read", "message_agent", "react_to_message"):
        assert policy.is_messaging(name) and policy.is_blocked(name)
    for name in ("kanban_create", "browser_vault", "computer_use", "tool_call", "meet_join"):
        assert policy.is_blocked(name)
    for name in ("yb_send_dm", "yb_send_sticker", "yb_query_group_info"):  # Yuanbao, registered by core
        assert policy.is_messaging(name) and policy.is_blocked(name)
    for name in ("terminal", "todo_list", "skill_manage", "web_search"):
        assert not policy.is_blocked(name)
    assert policy.args_hash({"b": 1, "a": 2}) == policy.args_hash({"a": 2, "b": 1})


# ---------------------------------------------------------------- seed tree

@pytest.mark.skipif(shutil.which("git") is None, reason="git not available")
def test_git_tree_id_matches_git():
    repo = paths.agent_dir()
    for rel in ("skills/creative/p5js", "skills/productivity/product-price-monitor", "skills/note-taking"):
        want = subprocess.run(["git", "rev-parse", f"HEAD:apps/agent/hermes/{rel}"], cwd=repo,
                              capture_output=True, text=True).stdout.strip()
        if not want:
            pytest.skip("not a git checkout")
        assert seed.git_tree_id(HERMES_SKILLS / rel.removeprefix("skills/")) == want


def _on_windows(monkeypatch):
    """seed.py as it runs on Windows, where files have no exec bit."""
    from types import SimpleNamespace
    monkeypatch.setattr(seed, "sys", SimpleNamespace(platform="win32"))


def test_committed_reviewed_trees_match_on_windows(tmp_path, monkeypatch):
    """Windows has no exec bit, so the tree id there takes each file's mode from the entry's
    ``exec`` list (recorded from git by make hermes-skills-review). Guessing from a shebang
    marked 100644 scripts that start with ``#!`` executable, so prepare on Windows found
    youtube-content, microsoft-office, pdf and arxiv unreviewed and the Windows stage failed."""
    reviewed = seed.load_reviewed(paths.skills_reviewed_file())
    denied = seed.load_denied(seed.denied_file_for(paths.skills_reviewed_file()))
    hermes = paths.hermes_dir()
    native = {}
    for rel, entry in reviewed.items():
        d = hermes / rel
        if d.is_dir() and seed.git_tree_id(d) == entry["tree"]:
            native[rel] = d
    assert len(native) > 100
    _, linux = seed.build_seed_tree(paths.AgentLayout.at(tmp_path / "linux"), upstream=HERMES_SKILLS,
                                    overrides=None, reviewed=reviewed, denied=denied)
    _on_windows(monkeypatch)
    differ = [rel for rel, d in native.items() if seed.reviewed_tree_id(d, reviewed[rel]) != reviewed[rel]["tree"]]
    assert differ == []
    _, win = seed.build_seed_tree(paths.AgentLayout.at(tmp_path / "win"), upstream=HERMES_SKILLS,
                                  overrides=None, reviewed=reviewed, denied=denied)
    assert win["unreviewed"] == [] and win["seeded"] == linux["seeded"] and len(win["seeded"]) >= 30


def test_windows_tree_id_takes_modes_from_the_exec_list(tmp_path, monkeypatch):
    skill = tmp_path / "demo"
    (skill / "scripts").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: demo\n---\n")
    (skill / "scripts" / "run.sh").write_text("#!/bin/sh\necho hi\n")
    (skill / "scripts" / "lib.py").write_text("#!/usr/bin/env python3\n")
    os.chmod(skill / "scripts" / "run.sh", 0o755)
    os.chmod(skill / "scripts" / "lib.py", 0o644)
    if os.name != "posix":
        pytest.skip("needs POSIX modes for the reference id")
    want = seed.git_tree_id(skill)
    entry = {"tree": want, "exec": ["scripts/run.sh"]}
    _on_windows(monkeypatch)
    assert seed.reviewed_tree_id(skill, entry) == want
    assert seed.reviewed_tree_id(skill, {"tree": want}) != want  # no list: nothing is executable
    assert seed.reviewed_tree_id(skill, dict(entry, exec=["scripts/run.sh", "scripts/lib.py"])) != want


def _reviewed_for(*rels, default="on"):
    return {f"skills/{r}": {"tree": seed.git_tree_id(HERMES_SKILLS / r), "default": default} for r in rels}


def test_seed_tree_keeps_only_reviewed_and_applies_overrides(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    reviewed = _reviewed_for("note-taking/obsidian", "productivity/product-price-monitor")
    reviewed["skills/autonomous-ai-agents/hermes-agent"] = {
        "tree": seed.git_tree_id(HERMES_SKILLS / "autonomous-ai-agents/hermes-agent"), "default": "off"}
    reviewed.update(_reviewed_for("creative/p5js", default="off"))
    reviewed["skills/research/arxiv"] = {"tree": "0" * 40}  # stale entry: tree changed upstream
    overrides = harness.AGENT_DIR / "tests" / "fixtures" / "skills" / "overrides"
    out, report = seed.build_seed_tree(layout, upstream=HERMES_SKILLS, overrides=overrides, reviewed=reviewed)
    found = sorted(p.parent.relative_to(out).as_posix() for p in out.rglob("SKILL.md"))
    assert found == ["creative/p5js", "note-taking/obsidian", "productivity/product-price-monitor"]
    text = (out / "productivity/product-price-monitor/SKILL.md").read_text()
    assert "TIMELY-OVERRIDE-MARKER" in text
    assert "skills/research/arxiv" in report["unreviewed"]
    assert report["essential_off"] == ["skills/autonomous-ai-agents/hermes-agent"]
    assert "p5js" in report["default_off"]
    again, _ = seed.build_seed_tree(layout, upstream=HERMES_SKILLS, overrides=overrides, reviewed=reviewed)
    assert again == out


def test_seed_tree_without_reviewed_file_seeds_nothing(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    out, report = seed.build_seed_tree(layout, upstream=HERMES_SKILLS, overrides=None, reviewed=None)
    assert not list(out.rglob("SKILL.md")) and report["seeded"] == []


@pytest.mark.skipif(os.name != "posix", reason="symlinks need privileges on Windows")
def test_symlinks_never_reach_a_seeded_or_timely_skill(tmp_path):
    """A reviewed tree id hashes only a link's text; copying followed the link, so a reviewed
    skill holding a symlink seeded whatever it pointed at (the repo's .env) into every account."""
    secret = tmp_path / "secret.env"
    secret.write_text("JWT_SECRET=topsecret\n")
    upstream = tmp_path / "up" / "skills"
    skill = upstream / "cat" / "demo"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: demo\ndescription: d\n---\nbody\n")
    (skill / "references" / "notes.md").symlink_to(secret)
    (upstream / "cat" / "DESCRIPTION.md").symlink_to(secret)
    reviewed = {"skills/cat/demo": {"tree": seed.git_tree_id(skill)}}
    layout = paths.AgentLayout.at(tmp_path / "agent")
    out, report = seed.build_seed_tree(layout, upstream=upstream, overrides=None, reviewed=reviewed)
    assert report["symlinked"] == ["skills/cat/demo"] and report["seeded"] == []
    assert not any("topsecret" in p.read_text() for p in out.rglob("*") if p.is_file())
    timely_src = tmp_path / "timely-src" / "t"
    timely_src.mkdir(parents=True)
    (timely_src / "SKILL.md").write_text("---\nname: t\ndescription: d\n---\n")
    (timely_src / "leak.md").symlink_to(secret)
    with pytest.raises(ValueError, match="symlinks"):
        seed.build_timely_skills(paths.AgentLayout.at(tmp_path / "agent2"), timely_src.parent)


def test_timely_skills_copy_is_read_only(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    src = harness.AGENT_DIR / "tests" / "fixtures" / "skills"
    out = seed.build_timely_skills(layout, src)
    assert (out / "timely" / "SKILL.md").is_file() and not (out / "overrides").exists()
    assert seed.build_timely_skills(layout, src) == out
    if os.name == "posix":
        assert stat.S_IMODE((out / "timely" / "SKILL.md").stat().st_mode) == 0o444
        assert stat.S_IMODE((out / "timely").stat().st_mode) == 0o555
        if os.geteuid() != 0:
            with pytest.raises(PermissionError):
                (out / "timely" / "SKILL.md").write_text("changed")
    seed.remove_tree(out)
    assert not out.exists()


# ---------------------------------------------------------------- protocol descriptors (contract test 19, mechanism)

def test_protocol_moves_off_stdio(tmp_path):
    """After the move, prints, fd-1 writes and child processes reach stderr; only the protocol
    write reaches the parent's stdout, and children do not inherit the protocol descriptors."""
    script = tmp_path / "probe.py"
    script.write_text(f"""
import os, subprocess, sys
sys.path.insert(0, {str(harness.AGENT_DIR / 'timely_agent')!r})
import boot
pin, pout = boot._move_protocol_off_stdio()
print("stray print")
os.write(1, b"stray fd1\\n")
subprocess.run([sys.executable, "-c", "import os; print('child stdout'); os.write(1, b'child fd1\\\\n')"])
assert not os.get_inheritable(pin) and not os.get_inheritable(pout)
os.write(pout, b'{{"type":"log","text":"protocol"}}\\n')
""")
    proc = subprocess.run([harness.python(), "-I", str(script)], capture_output=True, timeout=60)
    assert proc.returncode == 0, proc.stderr.decode()
    assert proc.stdout == b'{"type":"log","text":"protocol"}\n'
    err = proc.stderr.decode()
    for text in ("stray print", "stray fd1", "child stdout", "child fd1"):
        assert text in err


def test_packaged_site_packages_run_their_pth_files(tmp_path):
    """The packaged runtime has no venv: ``app/site-packages`` is a plain folder, and site.py
    under ``-I`` never reads its ``.pth`` files. pywin32 (the MCP SDK on Windows) lives in
    ``win32/`` and ``win32/lib/`` and only imports once ``pywin32.pth`` ran, so ``_fix_sys_path``
    must register the folder as a site dir and keep the order hermes, app, site-packages, the
    folders its ``.pth`` files add, then the stdlib."""
    app = tmp_path / "app"
    (app / "timely_agent").mkdir(parents=True)
    (app / "hermes").mkdir()
    shutil.copy(harness.AGENT_DIR / "timely_agent" / "boot.py", app / "timely_agent" / "boot.py")
    site = app / "site-packages"
    (site / "win32" / "lib").mkdir(parents=True)
    (site / "win32" / "lib" / "probe_types.py").write_text("VALUE = 'from the pth folder'\n")
    (site / "probe_bootstrap.py").write_text("import os\nos.environ['PROBE_PTH_RAN'] = '1'\n")
    (site / "probe.pth").write_text("win32\nwin32/lib\nimport probe_bootstrap\n")
    script = tmp_path / "probe.py"
    script.write_text(f"""
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("timely_boot", {str(app / 'timely_agent' / 'boot.py')!r})
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)
boot._fix_sys_path()
import probe_types
app = {str(app)!r}
print(json.dumps({{"path": [os.path.relpath(p, app) for p in sys.path[:5]], "value": probe_types.VALUE,
                  "ran": os.environ.get("PROBE_PTH_RAN")}}))
""")
    proc = subprocess.run([harness.python(), "-I", "-B", str(script)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    got = json.loads(proc.stdout)
    assert got["value"] == "from the pth folder" and got["ran"] == "1"
    assert got["path"][:5] == ["hermes", ".", "site-packages", os.path.join("site-packages", "win32"),
                               os.path.join("site-packages", "win32", "lib")]


def test_gate_blocks_messaging_and_never_offered_names_without_asking_go():
    """Plan 8.3: timely_gate's name block is the layer under the toolset selection. A messaging or
    never-offered tool the model names gets ``block`` and never reaches Go (``gate.ask``), even
    with a live run and a pre-approval for that exact call."""
    from timely_agent import bridge
    from timely_agent.plugins import timely_gate
    asked: list[dict] = []
    old_ask = bridge.ask
    bridge.ask = lambda msg, timeout: asked.append(msg) or {"type": "gate.verdict", "verdict": "allow"}
    try:
        for name in ("send_message", "a2a_call", "discord", "kanban_create", "meet_join", "tool_call",
                     "yb_send_dm", "browser_vault", "set_theme"):
            run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c",
                                    pre_approved={"tool": name, "args_hash": policy.args_hash({})})
            token = bridge.current_run.set(run)
            try:
                verdict = timely_gate.pre_tool_call(tool_name=name, args={}, tool_call_id="t")
            finally:
                bridge.current_run.reset(token)
            assert verdict and verdict["action"] == "block" and "not available in Timely" in verdict["message"], \
                (name, verdict)
        assert asked == []
        # the control: an ordinary tool does reach Go
        token = bridge.current_run.set(bridge.RunContext(run_id="r", session_key="k", conversation_id="c"))
        try:
            assert timely_gate.pre_tool_call(tool_name="terminal", args={"command": "ls"}) is None
        finally:
            bridge.current_run.reset(token)
        assert [m["tool"] for m in asked] == ["terminal"]
    finally:
        bridge.ask = old_ask


# ---------------------------------------------------------------- phase 2

class _Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def test_delta_coalescer_rate_size_order_and_flush():
    from timely_agent.run_chat import DeltaCoalescer
    clock, out = _Clock(), []
    c = DeltaCoalescer(lambda kind, payload: out.append((kind, payload)), interval=0.05, max_chars=200, clock=clock)
    c.push("a")  # first text goes out at once (nothing sent for an interval)
    assert out == [("delta", {"text": "a"})]
    for _ in range(10):
        clock.now += 0.001
        c.push("bb")  # inside 50 ms: held
    assert len(out) == 1
    clock.now += 0.05
    c.push("c")  # the interval passed: everything held goes out in one delta
    assert out[-1] == ("delta", {"text": "b" * 20 + "c"})
    c.push("x" * 250)  # 200 characters waiting: sent without waiting for the interval
    assert out[-1] == ("delta", {"text": "x" * 250})
    c.push("tail")
    c.emit("tool.started", {"tool": "t"})  # any other event flushes first, order kept
    assert out[-2:] == [("delta", {"text": "tail"}), ("tool.started", {"tool": "t"})]
    c.push("end")
    c.close()
    assert out[-1] == ("delta", {"text": "end"})
    assert "".join(p["text"] for k, p in out if k == "delta") == "a" + "b" * 20 + "c" + "x" * 250 + "tailend"


def test_delta_coalescer_timer_flushes_a_paused_stream():
    import time
    from timely_agent.run_chat import DeltaCoalescer
    out = []
    c = DeltaCoalescer(lambda kind, payload: out.append(payload["text"]), interval=0.05)
    c.push("first")
    c.push("held")
    assert out == ["first"]
    deadline = time.monotonic() + 2
    while len(out) < 2 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert out == ["first", "held"]
    c.close()


def test_run_context_taint_is_append_only_and_deduplicated():
    from timely_agent import bridge
    run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c",
                            tainted_sources=[{"kind": "web", "tool": "web_extract", "host": "a.example"}])
    sent = []
    old = bridge.notify
    bridge.notify = lambda msg: sent.append(msg) or True
    try:
        new = bridge.report_taint(run, [{"host": "a.example", "tool": "web_extract", "kind": "web"},
                                        {"kind": "timely", "tool": "ask_bot"}, {"kind": "timely", "tool": "ask_bot"}])
        assert new == [{"kind": "timely", "tool": "ask_bot"}]
        assert sent == [{"type": "taint", "run": "r", "sources": new}]
        assert bridge.report_taint(run, [{"kind": "timely", "tool": "ask_bot"}]) == [] and len(sent) == 1
        assert run.taint_snapshot() == [{"kind": "web", "tool": "web_extract", "host": "a.example"},
                                        {"kind": "timely", "tool": "ask_bot"}]
    finally:
        bridge.notify = old


def test_run_context_batches_by_id_and_after_a_renamed_id():
    from timely_agent import bridge
    run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c")
    run.record_batch([("call_1", "get_task"), ("call_2", "propose_changes")])
    batch = run.batch_for("call_2", "propose_changes")
    assert batch.size == 2 and batch.siblings("call_2", "propose_changes") == ["get_task"]
    run.record_batch([("call_1", "propose_changes")])  # Hermes runs it as call_1_d2
    renamed = run.batch_for("call_1_d2", "propose_changes")
    assert renamed.size == 1 and renamed.siblings("call_1_d2", "propose_changes") == []
    assert run.batch_for("call_9", "get_task") is None  # not in the latest response
    assert bridge.RunContext(run_id="r", session_key="k", conversation_id="c").learning_writes is False
    assert bridge.RunContext(run_id="r", session_key="k", conversation_id="c",
                             flags={"learning_writes": "true"}).learning_writes is False


def _gate(run, name, call_id="t", **kw):
    from timely_agent import bridge
    from timely_agent.plugins import timely_gate
    token = bridge.current_run.set(run)
    try:
        return timely_gate.pre_tool_call(tool_name=name, args=kw, tool_call_id=call_id)
    finally:
        bridge.current_run.reset(token)


def test_gate_propose_changes_alone_and_unknown_batch(monkeypatch):
    from timely_agent import bridge
    from timely_agent.plugins import timely_gate
    monkeypatch.setattr(timely_gate, "_timely_tool", lambda name: name in ("propose_changes", "get_task"))
    run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c")
    verdict = _gate(run, "propose_changes", "call_1")
    assert verdict["action"] == "block" and "could not tell" in verdict["message"]
    run.record_batch([("call_1", "propose_changes"), ("call_2", "get_task")])
    verdict = _gate(run, "propose_changes", "call_1")
    assert verdict == {"action": "block", "message": policy.PROPOSE_ALONE}
    assert _gate(run, "get_task", "call_2") is None  # the sibling read itself is fine
    run.record_batch([("call_3", "propose_changes")])
    assert _gate(run, "propose_changes", "call_3") is None


def test_gate_ends_the_turn_on_a_tool_call_after_end_turn(monkeypatch):
    from timely_agent import bridge
    from timely_agent.plugins import timely_gate
    monkeypatch.setattr(timely_gate, "_timely_tool", lambda name: True)
    calls = []

    class Agent:
        def interrupt(self, message=None, **kw):
            calls.append((message, kw))
    run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c", agent=Agent())
    run.end_turn = True
    verdict = _gate(run, "get_task")
    assert verdict["action"] == "block" and "turn has ended" in verdict["message"]
    assert run.end_turn_hit is True and calls == [(None, {"tool_reason": "timely_end_turn"})]


def test_learning_writes_off_blocks_skill_manage_and_memory(monkeypatch):
    from timely_agent import bridge
    from timely_agent.plugins import timely_learning
    monkeypatch.setattr(timely_learning, "external_skill", lambda name: False)
    for flags, blocked in (({}, True), ({"learning_writes": False}, True), ({"learning_writes": True}, False)):
        run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c", flags=flags)
        token = bridge.current_run.set(run)
        try:
            for name, args in (("skill_manage", {"action": "create", "name": "mine"}), ("memory", {"action": "add"})):
                verdict = timely_learning.pre_tool_call(tool_name=name, args=args)
                assert (verdict is not None and verdict["message"] == timely_learning.LEARNING_OFF) is blocked, \
                    (flags, name, verdict)
        finally:
            bridge.current_run.reset(token)
    # outside a run: blocked (fail closed)
    assert timely_learning.pre_tool_call(tool_name="memory", args={})["message"] == timely_learning.NO_LEARNING_RUN
    # the words match the switch, not "not ... yet" (review round 7)
    assert "learning is off for this chat" in timely_learning.LEARNING_OFF and "yet" not in timely_learning.LEARNING_OFF


@pytest.mark.parametrize("name", ["hermes-agent", "release..notes", "notes/../hermes-agent", "Pantry steps", "timely"])
def test_skill_manage_refuses_names_timely_cannot_keep(monkeypatch, name):
    """Hermes accepts ``release..notes`` and ``hermes-agent``; Go cannot store the first, and the second is
    never turned off (a restored one would sit in every chat's skills index), so neither is learned."""
    from timely_agent import bridge
    from timely_agent.plugins import timely_learning
    monkeypatch.setattr(timely_learning, "external_skill", lambda n: False)
    run = bridge.RunContext(run_id="r", session_key="k", conversation_id="c", flags={"learning_writes": True})
    token = bridge.current_run.set(run)
    try:
        for args in ({"action": "create", "name": name, "content": "x"},
                     {"action": "create", "name": "", "operations": [{"action": "create", "name": name}]}):
            verdict = timely_learning.pre_tool_call(tool_name="skill_manage", args=args)
            assert verdict and verdict["action"] == "block" and "can't keep a skill named" in verdict["message"], args
    finally:
        bridge.current_run.reset(token)


# Tools chat may call that bring no outside text into the session: Timely's own skills and memory, the
# to-do list, file writes (their result is what was written), and past-chat search, whose taint the
# session-taint gate gives per hit.
NOT_TAINT = frozenset({"skills_list", "skill_view", "skill_manage", "memory", "todo_list", "session_search",
                       "write_file", "patch"})


def test_every_tool_chat_may_call_has_a_taint_classification():
    """ADR 0028 / plan 9b.5: a tool chat may call (allow or approve) either carries a taint kind or is
    named in NOT_TAINT, so a new outside-text tool cannot slip in as clean."""
    scripts = Path(__file__).resolve().parents[3] / "scripts" / "hermes-sync"
    sys.path.insert(0, str(scripts))
    try:
        import check_lib
    finally:
        sys.path.remove(str(scripts))
    tools_yaml = Path(__file__).resolve().parents[1] / ".hermes-sync" / "policy" / "tools.yaml"
    entries = check_lib.yaml_load(tools_yaml.read_text(encoding="utf-8"), "tools.yaml")
    entries = entries.get("tools", entries)
    missing = []
    for key, entry in entries.items():
        if not isinstance(entry, dict) or entry.get("chat") == "block":
            continue
        name = key.partition("@")[0]
        if name not in NOT_TAINT and not policy.taint_kind(name, str(entry.get("toolset") or "")):
            missing.append(key)
    assert missing == [], f"classify these tools' taint in policy.TAINT_SOURCES or list them in NOT_TAINT: {missing}"


def test_taint_sources_policy():
    assert policy.taint_kind("web_extract") == "web" and policy.taint_kind("browser_navigate") == "browser"
    assert policy.taint_kind("read_file") == "file" and policy.taint_kind("delegate_task") == "subagent"
    assert policy.taint_kind("anything", "mcp-github") == "mcp" and policy.taint_kind("mcp_github_issue") == "mcp"
    for name in ("todo_list", "skill_view", "get_task", "propose_changes"):
        assert policy.taint_kind(name) == "", name
    assert policy.taint_host({"url": "https://Shop.Example:8443/x"}) == "shop.example"
    assert policy.taint_host({"url": "shop.example/x"}) == "shop.example"
    assert policy.taint_host({"query": "x"}) == ""


def test_phase2_floors_and_soul(tmp_path):
    f = config_render.managed_floors(timely_skills_dir=tmp_path)
    assert f["context"] == {"engine": "compressor"}
    assert f["agent"]["environment_probe"] is False
    assert f["tools"]["tool_search"]["enabled"] == "off"  # measured, timely_agent/README.md
    soul = config_render.SOUL_TEXT
    assert soul.startswith("You are Timely, the assistant inside the Timely app.")
    assert "Hermes" not in soul and "Nous" not in soul

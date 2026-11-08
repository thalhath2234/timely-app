"""Stdlib-level units: protocol framing, paths, environment rules, config rendering, seed tree."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
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
                                  "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "PYTHONPATH"])
def test_forbidden_env_is_refused(tmp_path, name):
    _, env = _good_env(tmp_path)
    env[name] = "x"
    problems, _ = env_check.check(env)
    assert any(name in p for p in problems)


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


# ---------------------------------------------------------------- policy

def test_messaging_and_blocked_names():
    for name in ("discord", "send_message", "a2a_call", "feishu_doc_read", "message_agent", "react_to_message"):
        assert policy.is_messaging(name) and policy.is_blocked(name)
    for name in ("kanban_create", "browser_vault", "computer_use", "tool_call"):
        assert policy.is_blocked(name)
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

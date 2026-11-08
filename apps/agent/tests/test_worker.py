"""Real worker processes over stdin/stdout against the stub model (no network, no live AI).

Covers plan section 5.1 (hello/ready/self-test, run.start -> run.done, account checks, errors),
3.3 (protocol off stdio), 4.4 (install guard), 6.3 (managed canary), 6.4 (environment refusal),
9.1 (seed tree). The contract tests of plan 10.4 f are in ``tests/contract`` (``make agent-contract``).
"""

from __future__ import annotations

import json
import subprocess


import harness
from timely_agent import config_render, paths

TIMELY_PLUGINS = {"timely_gate", "timely_tools", "timely_learning", "timely_bot"}


def _events(seen, kind=None):
    return [m for m in seen if m.get("type") == "event" and (kind is None or m.get("kind") == kind)]


def _all_stdout_is_protocol(w):
    for line in w.raw_lines:
        msg = json.loads(line)
        assert msg.get("type") and msg.get("account") in (None, "user-1"), line


# ---------------------------------------------------------------- hello / ready

def test_ready_reports_self_test(agent, worker):
    ready = worker.ready_msg
    assert ready["type"] == "ready" and ready["id"] == "h1" and ready["account"] == "user-1"
    assert ready["self_test"]["ok"], ready["self_test"]
    assert ready["protocol"] == 1 and ready["self_test"]["failures"] == []
    assert ready["config_sha256"] == agent.rendered["config_sha256"]
    names = {c["name"] for c in ready["self_test"]["checks"]}
    assert {"plugins", "gate_hook", "home", "no_messaging", "managed_config", "install_guard", "mcp"} <= names
    assert TIMELY_PLUGINS <= set(ready["plugins_loaded"])
    assert ready["hermes_tag"].startswith("v")
    assert ready["catalog_version"] == "test-1"
    from timely_agent import policy
    assert not [t for t in ready["tools"] if policy.is_messaging(t)]
    assert "terminal" in ready["tools"] and "todo_list" in ready["tools"]


def test_seed_tree_reached_the_home(agent, worker):
    seeded = list((agent.home / "skills").rglob("SKILL.md"))
    assert seeded, "sync_skills seeded nothing"
    # essential-off Hermes-self skill never reaches an account
    assert not (agent.home / "skills" / "autonomous-ai-agents" / "hermes-agent").exists()
    cfg = json.loads((agent.home / "config.yaml").read_text().split("\n", 1)[1])
    assert cfg["skills"]["external_dirs"] == [agent.prepared["timely_skills_dir"]]


# ---------------------------------------------------------------- runs

def test_plain_turn(agent, worker, stub):
    worker.send(harness.run_start(agent, stub, run_id="r-plain", text="hello there", conversation="c-plain"))
    done, seen = worker.until("run.done")
    assert done["id"] == "s-r-plain" and done["run"] == "r-plain"
    assert done["final_response"] == "Stub reply: hello there"
    assert done["completed"] is True and done["interrupted"] is False
    assert done["tokens"]["input_tokens"] > 0 and done["tokens"]["output_tokens"] > 0
    assert done["tainted_sources"] == []
    assert "".join(e["payload"]["text"] for e in _events(seen, "delta")) == "Stub reply: hello there"
    _all_stdout_is_protocol(worker)


def test_second_turn_reuses_session(agent, worker, stub):
    worker.send(harness.run_start(agent, stub, run_id="r-t2", text="second", conversation="c-plain"))
    done, _ = worker.until("run.done")
    assert done["final_response"] == "Stub reply: second"
    last = [r for r in stub.requests if r["method"] == "POST" and r["path"].endswith("/chat/completions")
            and any(m.get("content") == "second" for m in r["body"]["messages"] if m.get("role") == "user")]
    roles = [m["role"] for m in last[0]["body"]["messages"]]
    assert roles.count("user") >= 2, roles  # history from state.db came along


def test_gate_asks_go_and_blocks(agent, worker, stub):
    worker.send(harness.run_start(agent, stub, run_id="r-gate", conversation="c-gate", toolsets=["terminal"],
                                  text='CALL terminal {"command": "echo should-not-run"}'))
    ask, _ = worker.until("gate.ask")
    assert ask["tool"] == "terminal" and ask["run"] == "r-gate" and ask["run_kind"] == "chat"
    assert ask["args"]["command"] == "echo should-not-run" and ask["id"]
    worker.send({"type": "gate.verdict", "id": ask["id"], "account": agent.account, "verdict": "block",
                 "message": "Blocked by test policy"})
    done, seen = worker.until("run.done")
    assert "Blocked by test policy" in done["final_response"]
    assert not any("should-not-run" in json.dumps(e) and e.get("kind") == "tool.completed"
                   and "Blocked" not in json.dumps(e) for e in _events(seen))


def test_ping_pong_reports_busy(agent, worker):
    worker.send({"type": "ping", "id": "go-7", "account": agent.account})
    pong = worker.recv()
    assert pong == {"type": "pong", "id": "go-7", "account": agent.account,
                    "busy": {"runs": 0, "learning": False, "children": 0}}


def test_errors_and_account_checks(agent, worker, stub):
    worker.send({"type": "run.stop", "id": "e1", "account": "someone-else", "run": "x"})
    err = worker.recv()
    assert err["type"] == "error" and err["code"] == "wrong_account" and err["id"] == "e1"
    worker.send_raw(b"this is not json\n")
    assert worker.recv()["code"] == "bad_json"
    worker.send({"type": "run.stop", "id": "e2", "account": agent.account, "run": "nope"})
    assert worker.recv()["code"] == "unknown_run"
    worker.send({"type": "bot.run", "id": "e3", "account": agent.account})
    assert worker.recv()["code"] == "unsupported"
    worker.send(agent.hello(id="h2"))
    assert worker.recv()["code"] == "bad_message"
    bad = harness.run_start(agent, stub, run_id="r-bad")
    bad.pop("toolsets")
    worker.send(bad)
    assert worker.recv()["code"] == "bad_message"


def test_install_guard_refuses_in_worker_runtime(agent):
    script = f"""
import sys
sys.path[:0] = [{str(paths.hermes_dir())!r}, {str(paths.agent_dir())!r}]
from timely_agent import install_guard
install_guard.install()
assert install_guard.active()
import pm.extras, pm.client, pm.install
from pm.package import InstallError
assert pm.install.lazy_installs_allowed() is False
for call in (lambda: pm.client.ensure("node"), lambda: pm.client.sync_venv(["voice"]),
             lambda: pm.extras.ensure_import("matrix"), lambda: pm.install.ensure("chromium")):
    try:
        call()
    except InstallError as exc:
        assert "fixed" in str(exc), exc
    else:
        raise SystemExit("not refused")
print("ok", len(install_guard.refusals))
"""
    env = agent.env()
    proc = subprocess.run([harness.python(), "-I", "-c", script], capture_output=True, text=True, env=env, timeout=120)
    assert proc.returncode == 0 and proc.stdout.startswith("ok 4"), proc.stderr[-3000:]


# ---------------------------------------------------------------- refusals (fresh workers)

def test_hello_checks_home_and_settings_hash():
    a = harness.Agent(harness.new_root("hello"))
    w = harness.Worker(a.env())
    try:
        w.send({"type": "run.start", "id": "x", "account": a.account, "run": "r", "conversation_id": "c",
                "toolsets": []})
        assert w.recv()["code"] == "not_ready"
        w.send(a.hello(id="h-bad-hash", settings_hash="0" * 64))
        err = w.recv()
        assert err["code"] == "config_mismatch" and err["id"] == "h-bad-hash"
        assert err["account"] == a.account  # errors before hello still name the account
        w.send(a.hello(id="h-bad-home", home=str(a.home.parent / "account-other")))
        assert w.recv()["code"] == "home_mismatch"
        w.send(a.hello(id="h-bad-proto", protocol=99))
        assert w.recv()["code"] == "protocol_mismatch"
        w.send(a.hello(id="h-ok"))
        ready, _ = w.until("ready", timeout=120)
        assert ready["self_test"]["ok"], ready["self_test"]
        w.send({"type": "shutdown", "id": "bye", "account": a.account, "grace": 1})
        assert w.proc.wait(30) == 0
    finally:
        w.close()


def test_hello_with_settings_renders_config(stub):
    """Go may send the settings in hello instead of running render-account; the worker renders
    them, overwriting a tampered config.yaml, and reports the new hash."""
    a = harness.Agent(harness.new_root("hset"))
    cfg_path = a.home / "config.yaml"
    cfg_path.write_text(cfg_path.read_text().replace('"mode": "manual"', '"mode": "off"'))  # tampered
    w = harness.Worker(a.env())
    try:
        w.send(a.hello(settings={"timezone": "Asia/Tokyo"}))
        ready, seen = w.until("ready", timeout=120)
        assert ready["self_test"]["ok"], ready["self_test"]
        assert ready["config_sha256"] == config_render.sha256_file(cfg_path)
        cfg = json.loads(cfg_path.read_text().split("\n", 1)[1])
        assert cfg["timezone"] == "Asia/Tokyo" and cfg["approvals"]["mode"] == "manual"
    finally:
        w.close()


def test_stdin_close_is_the_lifeline_and_real_home_untouched(stub):
    root = harness.new_root("life")
    a = harness.Agent(root)
    real = root / "real-home"
    real.mkdir()
    w, ready = harness.ready_worker(a)
    assert ready["self_test"]["ok"]
    w.send(harness.run_start(a, stub, run_id="r-life", text="hi"))
    w.until("run.done")
    assert w.close() == 0
    assert list(real.iterdir()) == []  # nothing written to the user's own home, no ~/.hermes
    assert not (a.home / "home" / ".hermes").exists()
    assert (a.home / "state.db").exists()

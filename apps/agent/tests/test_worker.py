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


def test_nan_in_model_tool_arguments_stays_valid_json(agent, worker, stub):
    """A model (or a prompt injection steering it) can put NaN in tool arguments; Hermes accepts
    it. Every line the worker writes must still be strict JSON Go can parse, and the run ends."""
    first = len(worker.raw_lines)
    worker.send(harness.run_start(agent, stub, run_id="r-nan", conversation="c-nan", toolsets=["todo"],
                                  text='CALL todo_list {"todos": [], "merge": NaN}'))
    done, seen = worker.until("run.done")
    assert done["run"] == "r-nan", done

    def refuse(token):
        raise AssertionError(f"non-standard JSON token {token} on the protocol")
    for line in worker.raw_lines[first:]:
        json.loads(line, parse_constant=refuse)
    started = _events(seen, "tool.started")
    assert started and started[0]["payload"]["args"]["merge"] is None, started


def test_second_turn_reuses_session(agent, worker, stub):
    worker.send(harness.run_start(agent, stub, run_id="r-t2", text="second", conversation="c-plain"))
    done, _ = worker.until("run.done")
    assert done["final_response"] == "Stub reply: second"
    last = [r for r in stub.requests if r["method"] == "POST" and r["path"].endswith("/chat/completions")
            and any(m.get("content") == "second" for m in r["body"]["messages"] if m.get("role") == "user")]
    roles = [m["role"] for m in last[0]["body"]["messages"]]
    assert roles.count("user") >= 2, roles  # history from state.db came along


def test_late_run_stop_never_drops_the_next_turn(agent, worker, stub):
    """run.stop acts only on the run it names. Stops that land while a turn is finishing (after
    Hermes cleared its interrupt, before the run left the worker's table) used to leave the
    conversation's cached agent interrupted, so the next run.start answered at once with
    "Stopped before this turn started" and dropped the person's message."""
    import threading
    import time
    for i in range(3):
        conv, first = f"c-late-stop-{i}", f"r-late-a{i}"
        worker.send(harness.run_start(agent, stub, run_id=first, conversation=conv, text="SLOW 0.2"))
        stop = threading.Event()

        def spam(run_id=first, stop=stop):
            while not stop.is_set():
                worker.send({"type": "run.stop", "account": agent.account, "run": run_id, "reason": "user"})
                time.sleep(0.0005)
        spammer = None
        try:
            while True:
                m = worker.recv(timeout=60, skip=("heartbeat", "log", "error"))
                if spammer is None and m.get("type") == "event":
                    spammer = threading.Thread(target=spam, daemon=True)
                    spammer.start()
                if m.get("type") == "run.done" and m.get("run") == first:
                    break
        finally:
            stop.set()
            if spammer is not None:
                spammer.join()
        second = f"r-late-b{i}"
        worker.send(harness.run_start(agent, stub, run_id=second, conversation=conv, text="next message"))
        while True:
            m = worker.recv(timeout=60, skip=("heartbeat", "log", "error", "event"))
            if m.get("type") == "run.done" and m.get("run") == second:
                break
        assert m["completed"] is True and m["interrupted"] is False, m
        assert m["final_response"] == "Stub reply: next message", m


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


def test_malformed_run_start_fields_are_refused_not_lost(agent, worker, stub):
    """A run.start with a wrong-shaped optional field is refused with an error answering its own
    id and run (so Go ends the run); before, the run thread died with no run.done and Go kept the
    run live forever. The worker forgets nothing: the next valid run completes."""
    for i, (field, value) in enumerate([("tainted_sources", 5), ("pre_approved", "x"), ("history", {"a": 1}),
                                        ("budgets", []), ("history", [1, 2]), ("toolsets", [1])]):
        run_id = f"r-shape-{i}"
        worker.send(harness.run_start(agent, stub, run_id=run_id, conversation=f"c-shape-{i}", **{field: value}))
        err = worker.recv(timeout=15)
        assert err["type"] == "error" and err["code"] == "bad_message", (field, err)
        assert err["id"] == f"s-{run_id}" and err["run"] == run_id and field in err["message"], (field, err)
    worker.send({"type": "ping", "id": "go-shape", "account": agent.account})
    assert worker.recv()["busy"]["runs"] == 0
    worker.send(harness.run_start(agent, stub, run_id="r-shape-ok", conversation="c-shape-ok", text="fine"))
    done, _ = worker.until("run.done")
    assert done["completed"] is True and done["run"] == "r-shape-ok", done


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
        # The "did not match settings_hash" warning goes to stderr: a protocol line sent before
        # the account is pinned would carry no account, and Go kills the worker for that.
        assert "did not match settings_hash" in w.stderr
        for line in w.raw_lines:
            assert json.loads(line).get("account") == a.account, line
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


def test_shutdown_grace_lets_a_run_waiting_on_go_finish(stub):
    """During the shutdown grace the worker keeps reading: a run waiting on gate.ask gets Go's
    verdict and finishes its turn. The worker used to handle shutdown on its only reader thread,
    so the verdict sat unread for the whole grace and the run ended interrupted."""
    import time
    a = harness.Agent(harness.new_root("grace"))
    w, ready = harness.ready_worker(a)
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        w.send(harness.run_start(a, stub, run_id="r-grace", conversation="c-grace", toolsets=["terminal"],
                                 text='CALL terminal {"command": "echo grace-ran"}'))
        ask, _ = w.until("gate.ask")
        started = time.monotonic()
        w.send({"type": "shutdown", "account": a.account, "grace": 20})
        # new work is refused while the worker stops
        w.send(harness.run_start(a, stub, run_id="r-late", conversation="c-late"))
        err = w.recv()
        assert err["type"] == "error" and err["code"] == "not_ready" and err["run"] == "r-late", err
        w.send({"type": "gate.verdict", "id": ask["id"], "account": a.account, "verdict": "allow"})
        done, seen = w.until("run.done", timeout=60)
        assert time.monotonic() - started < 10, "the run waited out the grace"
        assert done["completed"] is True and done["interrupted"] is False, done
        assert any("grace-ran" in json.dumps(e) for e in _events(seen, "tool.completed")), seen
        # it exits on its own once its runs are done, without Go closing stdin
        assert w.proc.wait(30) == 0
    finally:
        w.close()


def test_default_off_skills_never_come_from_prepared_json():
    """``runtime/prepared.json`` sits in the writable agent folder, so its ``skills_default_off``
    list must not decide which reviewed default-off skills stay off: render-account takes the
    list from Go (``--prepared``) and the worker from ``hello``. A tampered file changes
    nothing, and the self-test checks every default-off skill is in ``skills.disabled``."""
    a = harness.Agent(harness.new_root("doff"))
    off = a.prepared["skills_default_off"]
    assert "imessage" in off and "himalaya" in off, off
    state_file = a.layout.runtime_dir / "prepared.json"
    state = json.loads(state_file.read_text())
    state["skills_default_off"] = []
    state_file.write_text(json.dumps(state))

    def disabled() -> list[str]:
        cfg = json.loads((a.home / "config.yaml").read_text().split("\n", 1)[1])
        return cfg["skills"]["disabled"]

    a.render({})
    assert set(off) <= set(disabled()), disabled()
    w = harness.Worker(a.env())
    try:
        w.send(a.hello(settings={"skills_enabled": ["github"]}))
        ready, _ = w.until("ready", timeout=120)
        assert ready["self_test"]["ok"], ready["self_test"]
        assert "skills_default_off" in {c["name"] for c in ready["self_test"]["checks"]}
        assert set(off) - {"github"} <= set(disabled()) and "github" not in disabled(), disabled()
    finally:
        w.close()
    # hello without the list is refused like one without the other prepare values
    w = harness.Worker(a.env())
    try:
        msg = a.hello(id="h-no-off")
        del msg["skills_default_off"]
        w.send(msg)
        err = w.recv()
        assert err["code"] == "bad_message" and err["id"] == "h-no-off", err
    finally:
        w.close()


def test_run_thread_that_fails_to_start_frees_the_conversation(stub):
    """A run.start answered with ``internal`` (its thread could not start) has ended in Go, so the
    worker must forget it too: the next start on that conversation runs, and busy.runs is 0."""
    a = harness.Agent(harness.new_root("tfail"))
    wrapper = paths.agent_dir() / "tests" / "fixtures" / "threadfail_boot.py"
    w, ready = harness.ready_worker(a, argv=[harness.python(), "-I", str(wrapper), "worker"])
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        w.send(harness.run_start(a, stub, run_id="tf1", conversation="c-tf"))
        err = w.recv()
        assert err["type"] == "error" and err["code"] == "internal" and err["run"] == "tf1", err
        w.send({"type": "ping", "id": "p-tf", "account": a.account})
        assert w.recv()["busy"]["runs"] == 0
        w.send(harness.run_start(a, stub, run_id="tf2", conversation="c-tf"))
        done, _ = w.until("run.done", timeout=60)
        assert done["run"] == "tf2" and done["completed"], done
    finally:
        w.close()

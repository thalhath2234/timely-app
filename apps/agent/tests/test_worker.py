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


# ---------------------------------------------------------------- phase 2: Timely tools, taint, end of turn

PROPOSAL = {"summary": "Add a task", "steps": [{"tool": "create_task", "summary": "Add Buy milk",
                                                "arguments": {"title": "Buy milk"}}],
            "direct": True, "reply": "", "remaining": "", "language": "en"}


def _script(*steps) -> str:
    return "SCRIPT " + json.dumps(list(steps))


def _phase2_start(agent, stub, run_id, text, **extra):
    return harness.run_start(agent, stub, run_id=run_id, conversation=extra.pop("conversation", f"c-{run_id}"),
                             toolsets=harness.PHASE2_TOOLSETS, budgets=extra.pop("budgets", {}), text=text, **extra)


def test_hello_timely_tools_are_registered_and_reported(tagent, tworker):
    ready = tworker.ready_msg
    hello = harness.timely_tools()
    names = sorted(t["name"] for t in hello["tools"])
    assert len(names) == 49 and "propose_changes" in names and "get_task" in names
    assert ready["timely_tools"] == {"catalog_version": hello["catalog_version"], "registered": names}
    check = next(c for c in ready["self_test"]["checks"] if c["name"] == "timely_tools")
    assert check["ok"], check
    assert {"get_task", "propose_changes", "resolve_target"} <= set(ready["tools"])
    # write tools never arrive as Hermes tools
    assert not {"create_task", "update_doc", "delete_sheet_rows"} & set(ready["tools"])


def test_hello_timely_tools_of_the_wrong_shape_are_refused():
    a = harness.Agent(harness.new_root("tt-bad"))
    w = harness.Worker(a.env())
    try:
        good = harness.timely_tools(["get_task"])
        for bad in ([], {"tools": "x"}, {"tools": [{"description": "no name"}]},
                    {"tools": [{"name": "todo_list x"}]}, {"tools": [{"name": "send_message"}]},
                    {"tools": [good["tools"][0], good["tools"][0]]},
                    {"tools": [{"name": "get_x", "parameters": []}]}, {"tools": [{"name": "get_x", "outside": "yes"}]},
                    {"tools": [], "catalog_version": 7}):
            w.send(a.hello(timely_tools=bad))
            err = w.recv()
            assert err["type"] == "error" and err["code"] == "bad_message" and "timely_tools" in err["message"], (bad, err)
        w.send(a.hello(timely_tools=good))
        ready, _ = w.until("ready", timeout=120)
        assert ready["self_test"]["ok"] and ready["timely_tools"]["registered"] == ["get_task"], ready["self_test"]
    finally:
        w.close()


def test_hello_without_timely_tools_registers_none(agent, worker):
    assert worker.ready_msg["timely_tools"] == {"catalog_version": "", "registered": []}
    assert worker.ready_msg["self_test"]["ok"]


def test_outside_result_taints_the_run(tagent, tworker, stub):
    """``tool.result {outside: true}`` adds ``{kind: timely, tool}`` and sends ``taint`` once."""
    tworker.send(_phase2_start(tagent, stub, "w-out", _script(
        {"calls": [["ask_bot", {"bot": "b1", "question": "price?"}]]},
        {"calls": [["ask_bot", {"bot": "b1", "question": "again?"}]]}, {"text": "It is 42."})))
    done, seen = harness.drive(tworker, tagent.account, "w-out")
    source = {"kind": "timely", "tool": "ask_bot"}
    assert [m["sources"] for m in seen if m["type"] == "taint"] == [[source]]  # deduplicated
    calls = [m for m in seen if m["type"] == "tool.call"]
    assert [c["tainted_sources"] for c in calls] == [[], [source]]
    assert done["tainted_sources"] == [source] and done["final_response"] == "It is 42."


def test_restarted_worker_keeps_tainted_sources_from_run_start(tagent, tworker, stub):
    """Plan 9b.2: taint survives a reaped worker or Go restart because ``run.start`` hands the
    persisted list back. Every ``tool.call`` and ``run.done`` carries it; a new source is added
    after it and only the new one goes out as ``taint``."""
    earlier = [{"kind": "web", "tool": "web_extract", "host": "shop.example"}]
    tworker.send(_phase2_start(tagent, stub, "w-restart", _script(
        {"calls": [["get_task", {"id": "t1"}]]}, {"calls": [["ask_bot", {"bot": "b"}]]},
        {"calls": [["propose_changes", PROPOSAL]]}, {"text": "Done."}), tainted_sources=earlier))
    done, seen = harness.drive(tworker, tagent.account, "w-restart")
    new = {"kind": "timely", "tool": "ask_bot"}
    calls = {c["name"]: c for c in seen if c["type"] == "tool.call"}
    assert calls["get_task"]["tainted_sources"] == earlier
    assert calls["propose_changes"]["tainted_sources"] == earlier + [new]
    assert [m["sources"] for m in seen if m["type"] == "taint"] == [[new]]
    assert done["tainted_sources"] == earlier + [new]


def test_end_turn_allows_one_closing_sentence(tagent, tworker, stub):
    """Q-2.4: Go answers a recorded proposal with ``end_turn``; a plain closing reply ends the
    turn normally."""
    tworker.send(_phase2_start(tagent, stub, "w-close", _script(
        {"calls": [["propose_changes", PROPOSAL]]}, {"text": "I added Buy milk for you to approve."})))
    done, seen = harness.drive(tworker, tagent.account, "w-close")
    assert [c["name"] for c in seen if c["type"] == "tool.call"] == ["propose_changes"]
    assert done["final_response"] == "I added Buy milk for you to approve."
    assert done["completed"] is True and done["interrupted"] is False


def test_tool_call_after_end_turn_ends_the_turn_without_a_stop(tagent, tworker, stub):
    """Q-2.4: after ``end_turn`` any further tool call is blocked (never reaches Go) and ends the
    turn: ``turn_exit_reason: end_turn``, not interrupted, the closing text kept. The next turn
    on the conversation starts clean."""
    conv = "c-w-endturn"
    tworker.send(_phase2_start(tagent, stub, "w-endturn", _script(
        {"calls": [["propose_changes", PROPOSAL]]},
        {"text": "Recorded it.", "calls": [["get_context", {}]]}, {"text": "never reached"}), conversation=conv))
    done, seen = harness.drive(tworker, tagent.account, "w-endturn")
    assert [c["name"] for c in seen if c["type"] == "tool.call"] == ["propose_changes"]
    assert done["turn_exit_reason"] == "end_turn" and done["interrupted"] is False and done["completed"] is True
    assert done["final_response"] == "Recorded it.", done
    tworker.send(_phase2_start(tagent, stub, "w-endturn-2", "and now a plain question", conversation=conv))
    done, _ = harness.drive(tworker, tagent.account, "w-endturn-2")
    assert done["final_response"] == "Stub reply: and now a plain question" and done["interrupted"] is False


def test_steer_reaches_a_run_waiting_on_a_timely_tool(tagent, tworker, stub):
    sent = []

    def on_message(msg):
        if msg["type"] == "tool.call" and not sent:
            sent.append(1)
            tworker.send({"type": "run.steer", "id": "go-steer", "account": tagent.account, "run": "w-steer",
                          "text": "STEER also add eggs"})
    tworker.send(_phase2_start(tagent, stub, "w-steer", _script({"calls": [["get_task", {"id": "t1"}]]})))
    done, seen = harness.drive(tworker, tagent.account, "w-steer", on_message=on_message)
    acks = [m for m in seen if m["type"] == "ack" and m["id"] == "go-steer"]
    assert acks and acks[0]["ok"] is True, seen
    # Hermes wraps the steer as an out-of-band user message the model sees after the tool result
    assert "Steered: " in done["final_response"] and "STEER also add eggs" in done["final_response"], done


def test_stop_while_a_timely_tool_waits_on_go_ends_the_run(tagent, tworker, stub):
    """Go never answers the ``tool.call``; ``run.stop`` wakes the waiting call at once."""
    import time
    stopped = []

    def on_message(msg):
        if msg["type"] == "tool.call" and not stopped:
            stopped.append(time.monotonic())
            tworker.send({"type": "run.stop", "id": "go-stop", "account": tagent.account, "run": "w-stop",
                          "reason": "user"})
    tworker.send(_phase2_start(tagent, stub, "w-stop", _script({"calls": [["get_task", {"id": "t1"}]]})))
    done, _ = harness.drive(tworker, tagent.account, "w-stop", answer=lambda name, args: None, on_message=on_message)
    assert done["interrupted"] is True, done
    assert time.monotonic() - stopped[0] < 5, "run.done came long after run.stop"


def test_learning_writes_off_blocks_every_skill_manage_write(tagent, tworker, stub):
    """Phase 2 (plan 9b): ``flags.learning_writes`` false blocks skill_manage (all actions write)
    before anything is written; the flag set true lets the call through to Hermes (phase 3)."""
    content = "---\nname: my-notes\ndescription: Notes the agent keeps.\n---\nBody\n"
    args = json.dumps({"action": "create", "name": "my-notes", "content": content})
    tworker.send(_phase2_start(tagent, stub, "w-learn", f"CALL skill_manage {args}"))
    done, _ = harness.drive(tworker, tagent.account, "w-learn")
    assert "not saving skills or memory yet" in done["final_response"], done
    assert not list((tagent.home / "skills").rglob("my-notes"))
    tworker.send(_phase2_start(tagent, stub, "w-learn-on", f"CALL skill_manage {args}",
                               flags={"learning_writes": True}))
    done, _ = harness.drive(tworker, tagent.account, "w-learn-on")
    assert "not saving skills or memory yet" not in done["final_response"], done


def test_permission_and_learning_flag_are_validated(tagent, tworker, stub):
    for run_id, extra in (("w-perm-bad", {"permission": "yolo"}), ("w-flag-bad", {"flags": {"learning_writes": "no"}})):
        tworker.send(_phase2_start(tagent, stub, run_id, "hi", **extra))
        err = tworker.recv()
        assert err["type"] == "error" and err["code"] == "bad_message" and err["run"] == run_id, err
    for mode in ("supervised", "auto", "full"):
        tworker.send(_phase2_start(tagent, stub, f"w-perm-{mode}", f"mode {mode}", permission=mode))
        done, _ = harness.drive(tworker, tagent.account, f"w-perm-{mode}")
        assert done["final_response"] == f"Stub reply: mode {mode}"


def test_empty_budgets_use_hermes_own_turn_limit(tagent, tworker, stub):
    """Q-2.3: no Timely turn cap. With ``budgets: {}`` a turn runs past phase 1's old default of 30
    iterations; ``budgets.max_iterations`` still caps a run when Go sends one."""
    tworker.send(_phase2_start(tagent, stub, "w-loop", "LOOP 32"))
    done, _ = harness.drive(tworker, tagent.account, "w-loop", timeout=180)
    assert done["final_response"] == "Looped 32 times" and done["completed"] is True, done
    tworker.send(_phase2_start(tagent, stub, "w-loop-capped", "LOOP 32", budgets={"max_iterations": 3}))
    done, _ = harness.drive(tworker, tagent.account, "w-loop-capped", timeout=180)
    assert done["final_response"] != "Looped 32 times", done


PROBE_TURN_LIMIT = """
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from hermes_cli.config import TURN_LIMIT_UNLIMITED, load_config, resolve_turn_limit
from timely_agent import run_chat
print(json.dumps({"empty": run_chat.turn_limit({}), "none": run_chat.turn_limit(None),
                  "given": run_chat.turn_limit({"max_iterations": 7}),
                  "hermes": resolve_turn_limit((load_config().get("agent") or {}).get("max_turns")),
                  "unlimited": TURN_LIMIT_UNLIMITED,
                  "old_default": hasattr(run_chat, "DEFAULT_MAX_ITERATIONS")}))
"""


def test_turn_limit_is_hermes_default_from_config(agent):
    proc = subprocess.run([harness.python(), "-I", "-c", PROBE_TURN_LIMIT, str(paths.hermes_dir()), str(paths.agent_dir())],
                          capture_output=True, text=True, env=agent.env(), timeout=180)
    assert proc.returncode == 0, proc.stderr[-3000:]
    got = json.loads(proc.stdout.strip().splitlines()[-1])
    assert got["empty"] == got["none"] == got["hermes"] == got["unlimited"], got
    assert got["given"] == 7 and got["old_default"] is False, got


def test_stream_deltas_are_coalesced_and_never_lose_text(tagent, tworker, stub):
    """Q-2.5: 600 two-character chunks arrive over about 1.2 s; the worker sends at most one
    ``delta`` per 50 ms or 200 characters, the chunks join to the exact reply, and every delta
    comes before ``run.done``."""
    import time
    from stub_openai import stream_text
    started = time.monotonic()
    tworker.send(_phase2_start(tagent, stub, "w-stream", "STREAM 1200 2 2"))
    done, seen = harness.drive(tworker, tagent.account, "w-stream")
    elapsed = time.monotonic() - started
    deltas = [m for m in seen if m["type"] == "event" and m["kind"] == "delta"]
    text = "".join(d["payload"]["text"] for d in deltas)
    assert text == stream_text(1200) == done["final_response"]
    assert 2 <= len(deltas) <= 1200 // 200 + int(elapsed / 0.05) + 3, (len(deltas), elapsed)
    assert len(deltas) < 120, len(deltas)  # 600 chunks without coalescing
    assert all(len(d["payload"]["text"]) <= 200 + 2 for d in deltas)
    assert seen.index(deltas[-1]) < seen.index(done)


def test_record_events_writes_one_jsonl_per_scenario(tmp_path):
    """``record_events.py`` (``make agent-record-fixtures``): worker -> Go lines per scenario,
    ending with the run's ``run.done``, plus a manifest of what Go sent."""
    import record_events
    names = {"read_tool_then_reply", "propose_then_tool_call_ends_turn"}
    manifest = record_events.record(tmp_path, only=names)
    assert set(manifest["scenarios"]) == names
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([f"{n}.jsonl" for n in names] + ["manifest.json"])
    for name in names:
        lines = [json.loads(line) for line in (tmp_path / f"{name}.jsonl").read_text().splitlines()]
        assert lines[-1]["type"] == "run.done" and lines[-1]["run"] == f"run-{name}"
        assert all(m["account"] == record_events.ACCOUNT for m in lines)
        assert not {m["type"] for m in lines} & {"heartbeat", "log", "ready"}
        assert "api_key" not in json.dumps(manifest["scenarios"][name]["run_start"])
    ended = [json.loads(line) for line in (tmp_path / "propose_then_tool_call_ends_turn.jsonl").read_text().splitlines()]
    assert ended[-1]["turn_exit_reason"] == "end_turn"
    assert [m["name"] for m in ended if m["type"] == "tool.call"] == ["propose_changes"]


def test_history_seed_is_stored_once_and_kept_by_later_turns(agent, worker, stub):
    """Plan 5.4: Go sends ``history`` when ``state.db`` lacks the session. The worker writes the
    seed into ``state.db`` (Hermes stores only a turn's new messages), so the next turn still has
    it; a seed sent again for a known session is ignored, never duplicated."""
    seed = [{"role": "user", "content": "SEED-USER: plan my week"},
            {"role": "assistant", "content": "SEED-ASSISTANT: here is your week"}]
    conv = "c-seed"
    for run_id, text, history, seeded in (("r-seed-1", "first after restore", seed, True),
                                          ("r-seed-2", "second after restore", None, False),
                                          ("r-seed-3", "third with a stale seed", seed, False)):
        extra = {"history": history} if history else {}
        worker.send(harness.run_start(agent, stub, run_id=run_id, conversation=conv, text=text, **extra))
        done, _ = worker.until("run.done")
        assert done["history_seeded"] is seeded and done["final_response"] == f"Stub reply: {text}", done
        req = [r for r in stub.requests if r["method"] == "POST" and text in json.dumps(r["body"]["messages"][-1])][-1]
        contents = [m.get("content") for m in req["body"]["messages"]]
        assert contents.count("SEED-USER: plan my week") == 1, contents
        assert contents.count("SEED-ASSISTANT: here is your week") == 1, contents

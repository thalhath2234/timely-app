"""Phase 4 unit tests without Hermes: the clarify wait, sub-task policy and taint, the no-persist
log filter, the provider allowlist and the sign-in check, run.start shapes and config floors."""

from __future__ import annotations

import json
import logging
import threading
import time

import pytest

from timely_agent import bridge, config_render, delegation, env_check, no_persist, policy, selftest
from timely_agent import protocol as P
from timely_agent.worker import run_start_problem

QUESTIONS = [
    {"qid": "q0", "question": "Which list?", "choices": ["Work (Recommended)", "Home"],
     "choices_offered": ["Work", "Home"], "multi_select": False},
    {"qid": "q1", "question": "Note?", "choices": None, "choices_offered": None, "multi_select": False},
]


def make_run(run_id="r1", flags=None, kind="chat", timeout=5.0):
    events: list[tuple[str, dict]] = []
    run = bridge.RunContext(run_id=run_id, session_key=f"timely:u:{run_id}", conversation_id=f"c-{run_id}",
                            kind=kind, flags=dict(flags or {}), clarify_timeout_s=timeout)
    run.emit = lambda kind, payload: events.append((kind, payload))
    return run, events


def wait_in_thread(run, timeout):
    box: dict = {}

    def body():
        box["reply"] = bridge.clarify_wait(run, QUESTIONS, timeout, stopped_notice="stopped",
                                           timed_out_notice="late", undelivered_notice="lost")
    t = threading.Thread(target=body)
    t.start()
    return t, box


def request_of(events, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for kind, payload in list(events):
            if kind == "clarify.request":
                return payload
        time.sleep(0.01)
    raise AssertionError(f"no clarify.request: {events}")


# ---------------------------------------------------------------- clarify


def test_clarify_payload_strips_the_recommended_label():
    assert bridge.clarify_payload(QUESTIONS) == [
        {"qid": "q0", "question": "Which list?", "choices": ["Work", "Home"], "recommended": 0, "multi_select": False},
        {"qid": "q1", "question": "Note?", "choices": None, "recommended": None, "multi_select": False}]
    lone = [{"qid": "q0", "question": "Ok?", "choices": ["Yes"], "choices_offered": ["Yes"], "multi_select": False}]
    assert bridge.clarify_payload(lone)[0]["recommended"] is None


def test_clarify_answer_ends_the_wait_once():
    run, events = make_run()
    t, box = wait_in_thread(run, 5)
    req = request_of(events)
    assert req["timeout_s"] == 5 and bridge.clarify_pending("r1") == 1
    assert bridge.clarify_answer("other", req["request_id"], {"q0": "Home"}) is False  # another run
    assert bridge.clarify_answer("r1", req["request_id"], {"q0": "Home", "zz": "x"}) is True
    t.join(5)
    assert box["reply"] == {"answers": {"q0": "Home"}, "outcome": "submitted"}
    assert bridge.clarify_answer("r1", req["request_id"], {"q0": "Work"}) is False  # late
    assert [k for k, _ in events] == ["clarify.request", "clarify.closed"]
    assert events[-1][1] == {"request_id": req["request_id"], "outcome": "submitted"}
    assert bridge.clarify_pending() == 0


def test_clarify_times_out_and_cancels():
    run, events = make_run()
    t, box = wait_in_thread(run, 0.3)
    t.join(5)
    assert box["reply"] == {"answers": {}, "outcome": "timed_out", "notice": "late"}
    assert events[-1][1]["outcome"] == "timed_out"
    run2, events2 = make_run("r2")
    t, box = wait_in_thread(run2, 30)
    req = request_of(events2)
    assert bridge.cancel_clarify("r2", "bye") == 1
    t.join(5)
    assert box["reply"] == {"answers": {}, "outcome": "cancelled", "notice": "bye"}
    assert bridge.clarify_answer("r2", req["request_id"], {"q0": "Home"}) is False


def test_clarify_ends_when_the_run_is_stopped_and_without_a_channel():
    run, events = make_run()
    stopped = threading.Event()
    run.stopped = stopped.is_set
    t, box = wait_in_thread(run, 30)
    request_of(events)
    stopped.set()
    t.join(5)
    assert box["reply"]["outcome"] == "cancelled" and box["reply"]["notice"] == "stopped"
    lost, _ = make_run("r3")
    lost.emit = None
    assert bridge.clarify_wait(lost, QUESTIONS, 30, undelivered_notice="lost") == {
        "answers": {}, "outcome": "undelivered", "notice": "lost"}


# ---------------------------------------------------------------- sub-tasks


def test_delegate_verdicts():
    run, _ = make_run()
    one = {"tasks": [{"goal": "a"}]}
    assert delegation.verdict(run, {"tasks": [{"goal": "a"}, {"goal": "b"}]}) is None
    assert delegation.verdict(run, one) is None
    capped = delegation.verdict(run, one)
    assert capped["action"] == "block" and "3 sub-tasks" in capped["message"]
    assert delegation.verdict(run, {"action": "list"}) is None  # starts nothing
    fresh, _ = make_run("r4")
    assert delegation.verdict(fresh, {"tasks": [{"goal": str(i)} for i in range(4)]})["action"] == "block"
    assert fresh.children_reserved == 0  # a refused call counts nothing
    assert delegation.verdict(fresh, {"goal": "a", "background": True})["message"] == policy.CHILD_BACKGROUND
    assert delegation.verdict(fresh, {"goal": "a", "background": "false"}) is None
    for flags, kind in (({"from_bot": True}, "chat"), ({"no_persist": True}, "chat"), ({}, "bot"),
                        ({}, "bot_review")):
        other, _ = make_run(flags=flags, kind=kind)
        assert delegation.verdict(other, one)["message"] == policy.CHILD_NOT_HERE, (flags, kind)
        assert delegation.clarify_verdict(other)["message"] == policy.CLARIFY_NOT_HERE, (flags, kind)
    assert delegation.verdict(None, one)["action"] == "block"
    assert delegation.clarify_verdict(make_run()[0]) is None


def test_delegate_task_never_takes_images():
    run, _ = make_run()
    shapes = [{"tasks": [{"goal": "a", "images": ["https://attacker.example/p.png?d=SECRET"]}]},
              {"tasks": [{"goal": "a"}, {"goal": "b", "images": ["/home/someone/Pictures/passport.png"]}]},
              {"goal": "a", "images": ["https://attacker.example/p.png"]},
              {"tasks": [{"goal": "a"}], "images": ["/tmp/x.png"]}]
    for args in shapes:
        assert delegation.verdict(run, args) == {"action": "block", "message": policy.CHILD_IMAGES}, args
    assert run.children_reserved == 0  # a refused call counts nothing
    assert delegation.verdict(run, {"tasks": [{"goal": "a", "images": []}], "images": None}) is None


def test_child_verdicts_and_the_shared_pool():
    run, _ = make_run()
    bridge.child_started(run, "kid-1", "sa-1", "goal")
    for tool in ("propose_changes", "session_search", "skill_manage", "memory", "clarify", "delegate_task"):
        assert delegation.child_verdict(run, "kid-1", tool)["action"] == "block", tool
    assert run.child_tool_calls == 0  # blocked calls never count
    for _ in range(policy.CHILD_TOOL_CALL_POOL):
        assert delegation.child_verdict(run, "kid-1", "get_task") is None
    assert delegation.child_verdict(run, "kid-1", "get_task")["message"] == policy.CHILD_POOL_USED
    assert run.children["kid-1"].tool_calls == policy.CHILD_TOOL_CALL_POOL
    assert bridge.child_run("kid-1") is run
    assert bridge.child_stopped("kid-1").done is True and bridge.child_run("kid-1") is None


def test_child_taint_reaches_the_parent_marked(monkeypatch):
    sent = []
    monkeypatch.setattr(bridge, "notify", lambda msg: sent.append(msg) or True)
    run, _ = make_run()
    bridge.child_started(run, "kid-2", "sa-2", "read a page")
    src = {"kind": "web", "tool": "web_extract", "host": "news.example"}
    assert bridge.current_child(run, "kid-2") == "kid-2" and bridge.current_child(run, "c-r1") == ""
    bridge.report_taint(run, [src], "kid-2")
    bridge.report_taint(run, [src])  # the run's own read of the same page is a source of its own
    marked = dict(src, via="subagent", child="kid-2")
    assert run.taint_snapshot() == [marked, src]
    assert sent == [{"type": "taint", "run": "r1", "sources": [marked]}, {"type": "taint", "run": "r1", "sources": [src]}]
    bridge.forget_children(run)
    assert bridge.child_run("kid-2") is None


def test_batches_are_kept_per_conversation():
    run, _ = make_run()
    run.record_batch([("call_1", "propose_changes")])
    run.record_batch([("call_1", "get_task"), ("call_2", "get_task")], child="kid")
    assert run.batch_for("call_1", "propose_changes").size == 1
    assert run.batch_for("call_1", "get_task", child="kid").size == 2
    run.note_call("get_task", "call_9", child="kid")
    assert run.last_call("get_task") == "" and run.last_call("get_task", "kid") == "call_9"


def test_delegate_task_count_and_taint_policy():
    assert policy.delegate_task_count({"tasks": [{}, {}]}) == 2
    assert policy.delegate_task_count({"goal": "x"}) == 1 and policy.delegate_task_count({}) == 0
    assert "delegate_task" not in policy.TAINT_SOURCES and policy.taint_kind("delegate_task") == ""


def test_delegate_tasks_are_read_the_way_hermes_reads_them():
    """The gate sees raw arguments: a JSON-array string is a batch (Hermes parses it after the gate), and
    anything else Hermes could read differently is refused instead of counted as 0 children."""
    kids = [{"goal": "a"}, {"goal": "b"}, {"goal": "c"}]
    assert policy.delegate_task_count({"tasks": json.dumps(kids)}) == 3
    assert policy.delegate_task_count({"tasks": "  " + json.dumps(kids[:1]) + " "}) == 1
    assert policy.delegate_tasks({"tasks": json.dumps(kids)}) == (kids, "")
    assert policy.delegate_tasks({"tasks": []}) == ([], "") and policy.delegate_tasks({}) == ([], "")
    for bad in ("not json", "", '{"goal": "x"}', "3", 7, {"goal": "x"}, [json.dumps(kids[0])], [None]):
        assert policy.delegate_tasks({"tasks": bad})[0] is None, bad
    run, _ = make_run()
    assert delegation.verdict(run, {"tasks": "not json"})["message"] == policy.CHILD_TASKS_SHAPE
    assert run.children_reserved == 0
    string_images = json.dumps([{"goal": "g", "images": ["https://attacker.example/p.png"]}])
    assert delegation.verdict(run, {"tasks": string_images})["message"] == policy.CHILD_IMAGES
    assert delegation.verdict(run, {"tasks": json.dumps(kids)}) is None and run.children_reserved == 3
    assert delegation.verdict(run, {"tasks": json.dumps(kids[:1])})["message"].startswith("Blocked: this reply already used")


def test_live_transcripts_are_recorded_and_forgotten(tmp_path):
    root = tmp_path / "cache" / "delegation" / "live"
    (root / "deleg_a").mkdir(parents=True)
    (root / "deleg_a" / "task-0.log").write_text("child text")
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    result = json.dumps({"results": [{"live_transcript": str(root / "deleg_a" / "task-0.log")}],
                         "live_transcripts": [str(root / "deleg_a" / "task-0.log"), str(outside / "x.log")]})
    assert delegation.record_live("c1", result, tmp_path) == ["deleg_a"]
    assert delegation.record_live("c1", "not json", tmp_path) == []
    assert delegation.forget("c2", tmp_path) == []
    assert delegation.forget("c1", tmp_path) == ["deleg_a"]
    assert not (root / "deleg_a").exists() and outside.exists()
    assert json.loads((tmp_path / ".timely" / "delegations.json").read_text()) == {}
    from timely_agent import backup
    assert backup.why_never((".timely", "delegations.json")) == "not agent state"


# ---------------------------------------------------------------- no-persist logs


def test_no_persist_filter_keeps_the_run_out_of_every_log():
    stderr, hermes = logging.StreamHandler(), logging.StreamHandler()
    stderr._timely_stderr = True
    root = logging.getLogger()
    root.addHandler(stderr)
    root.addHandler(hermes)
    try:
        no_persist.install()
        f_err = [f for f in stderr.filters if isinstance(f, no_persist.NoPersistFilter)][0]
        f_her = [f for f in hermes.filters if isinstance(f, no_persist.NoPersistFilter)][0]
        rec = logging.LogRecord("x", logging.INFO, __file__, 1, "msg='secret'", None, None)
        assert f_err.filter(rec) and f_her.filter(rec)
        run, _ = make_run(flags={"no_persist": True})
        token = bridge.current_run.set(run)
        try:
            assert not f_err.filter(rec) and not f_her.filter(rec)
        finally:
            bridge.current_run.reset(token)
        no_persist._live += 1
        try:  # another thread's record while a no-persist run is live: Hermes' files drop it
            assert f_err.filter(rec) and not f_her.filter(rec)
        finally:
            no_persist._live -= 1
        assert no_persist.install() == 0  # idempotent
    finally:
        root.removeHandler(stderr)
        root.removeHandler(hermes)


# ---------------------------------------------------------------- Q-4.1


@pytest.mark.parametrize("provider", sorted(policy.ALLOWED_PROVIDERS))
def test_allowed_providers_pass(provider):
    assert policy.provider_problem({"provider": provider, "api_key": "k"}) == ""


@pytest.mark.parametrize("provider", ["openai-codex", "nous", "copilot", "xai-oauth", "qwen-oauth", "minimax-oauth",
                                      "openai", "claude", "codex", "", None, "auto"])
def test_sign_in_and_unknown_providers_are_refused(provider):
    assert policy.provider_problem({"provider": provider})
    assert not policy.ALLOWED_PROVIDERS & policy.OAUTH_PROVIDERS


# Every key Hermes' own classifier (agent.anthropic_credentials._is_oauth_token) sends down its Claude Code
# OAuth path: Bearer auth, the Claude Code identity and the oauth betas on api.anthropic.com.
OAUTH_STYLE_KEYS = ["sk-ant-oat01-x", " sk-ant-oat01-x", "sk-ant-sid01-x", "sk-ant-x", "eyJhbGciOiJIUzI1NiJ9.x.sig", "cc-x0000"]


@pytest.mark.parametrize("key", OAUTH_STYLE_KEYS)
def test_claude_code_token_is_refused_whatever_its_prefix(key):
    assert "sign-in token" in policy.provider_problem({"provider": "anthropic", "api_key": key})
    assert policy.is_oauth_key(key)
    # Anthropic's wire format on its own host, or on none, takes the same path.
    for base in ("", "https://api.anthropic.com", "api.anthropic.com"):
        model = {"provider": "custom", "api_mode": "anthropic_messages", "base_url": base, "api_key": key}
        assert "sign-in token" in policy.provider_problem(model), base
    # A third-party endpoint authenticates with x-api-key whatever the key looks like.
    assert policy.provider_problem({"provider": "custom", "api_mode": "anthropic_messages",
                                    "base_url": "https://example.test/v1", "api_key": key}) == ""
    assert policy.provider_problem({"provider": "openrouter", "api_key": key}) == ""


@pytest.mark.parametrize("key", ["sk-ant-api03-x", "sk-ant-usr01-x", "sk-ant-svc01-x", "sk-ant-admin01-x", "x"])
def test_console_api_keys_are_not_refused(key):
    assert policy.provider_problem({"provider": "anthropic", "api_key": key}) == ""
    assert not policy.is_oauth_key(key)


def test_claude_code_token_and_missing_model_are_refused():
    assert "sign-in token" in policy.provider_problem({"provider": "anthropic", "api_key": " sk-ant-oat01-x"})
    assert policy.provider_problem({"provider": "anthropic", "api_key": "sk-ant-api03-x"}) == ""
    assert policy.provider_problem(None)


def test_sign_in_problems(tmp_path):
    ok = {"auth": {"adopt_external_logins": False}, "model": {"provider": "auto"}, "delegation": {"provider": ""},
          "auxiliary": {"compression": {"provider": "auto"}, "vision": {"provider": "openrouter"}}}
    oauth = set(policy.OAUTH_PROVIDERS)
    assert selftest.sign_in_problems(tmp_path, ok, oauth) == []
    bad = json.loads(json.dumps(ok))
    bad["delegation"]["provider"] = "nous"
    bad["auxiliary"]["compression"]["provider"] = "openai-codex"
    bad["model"]["provider"] = "bedrock"
    bad["auth"]["adopt_external_logins"] = True
    problems = selftest.sign_in_problems(tmp_path, bad, oauth)
    assert any("delegation.provider is 'nous', a sign-in provider" in p for p in problems), problems
    assert any("auxiliary.compression.provider is 'openai-codex'" in p for p in problems), problems
    assert any("model.provider is 'bedrock', a provider Timely does not run" in p for p in problems), problems
    assert any("adopt_external_logins" in p for p in problems), problems
    (tmp_path / ".anthropic_oauth.json").write_text("{}")
    assert any(".anthropic_oauth.json" in p for p in selftest.sign_in_problems(tmp_path, ok, oauth))


def test_claude_tokens_are_forbidden_in_the_worker_environment():
    for name in ("ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"):
        assert env_check._is_forbidden(name), name


# ---------------------------------------------------------------- run.start and config


def test_run_start_phase4_fields():
    ok = {"toolsets": ["timely", "todo", "clarify", "delegation"], "model": {"provider": "custom"},
          "clarify_timeout_s": 600, "flags": {"no_persist": False}}
    assert run_start_problem(ok) is None
    assert run_start_problem({**ok, "toolsets": ["timely", "todo"], "flags": {"no_persist": True}}) is None
    for bad in ({"clarify_timeout_s": 0}, {"clarify_timeout_s": True}, {"clarify_timeout_s": "600"},
                {"clarify_timeout_s": 90000}, {"flags": {"no_persist": 1}}, {"flags": {"no_persist": True}},
                {"model": {"provider": "nous"}}, {"model": None}):
        assert run_start_problem({**ok, **bad}), bad
    assert "clarify.answer" in P.GO_TYPES and "no_persist" in P.RUN_START_BOOL_FLAGS


def test_delegation_floors():
    floors = config_render.managed_floors(timely_skills_dir=None)
    assert floors["delegation"] == {
        "max_concurrent_children": 3, "max_spawn_depth": 1, "orchestrator_enabled": False, "max_iterations": 20,
        "child_timeout_seconds": 300, "subagent_auto_approve": False,
        "provider": "", "model": "", "base_url": "", "api_key": ""}
    assert "max_async_children" not in floors["delegation"]  # Hermes ignores it (deprecated)
    keys = config_render.canary_keys()
    assert "delegation.provider" in keys and "delegation.max_spawn_depth" in keys


def test_refused_delegation_gives_its_hold_back():
    """The cap counts children that started: a call's hold ends at its result, started children stay."""
    run, _ = make_run("r-settle")
    three = {"tasks": [{"goal": "t0"}, {"goal": "t1"}, {"goal": "t2"}]}
    assert delegation.verdict(run, three, "call-1") is None and run.children_reserved == 3
    assert delegation.verdict(run, {"goal": "x"}, "call-2")["message"].startswith("Blocked: this reply already used")
    delegation.settle(run, "call-1")  # Hermes refused the batch: no child ran
    assert run.children_reserved == 0
    assert delegation.verdict(run, {"goal": "a proper goal"}, "call-3") is None
    bridge.child_started(run, "child-1")
    delegation.settle(run, "call-3")
    assert run.children_reserved == 1 and run.children_started == 1
    assert delegation.verdict(run, {"tasks": [{"goal": "a"}, {"goal": "b"}]}, "call-4") is None
    assert delegation.verdict(run, {"goal": "c"}, "call-5") is not None
    delegation.settle(run, "call-4")
    delegation.settle(run, "unknown")
    assert run.children_reserved == 1

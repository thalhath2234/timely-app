"""Clarify contract tests (phase 4, Q-4.3): ``clarify`` is a question card the run waits on.

The worker sends ``event clarify.request`` and blocks the run's thread until Go's
``clarify.answer``, ``run.stop``, ``shutdown`` or ``run.start.clarify_timeout_s``; every way the
wait ends sends ``clarify.closed`` once, and the turn goes on where it was (the model reads
Hermes' clarify result). Real workers, the stub model; the test plays Go.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

import harness

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe_boot  # noqa: E402

TOOLSETS = ["timely", "todo", "clarify"]
PICK = {"questions": [{"question": "Which list should hold it?", "choices": ["Work", "Home", "Errands"]},
                      {"question": "Anything to add to the title?"}]}


@pytest.fixture(scope="module")
def cagent():
    return harness.Agent(harness.new_root("ccl"))


@pytest.fixture(scope="module")
def cworker(cagent):
    w, ready = harness.ready_worker(cagent, hello={"timely_tools": harness.timely_tools()})
    assert ready["self_test"]["ok"], ready["self_test"]
    yield w
    w.close()


def script(steps: list, tag: str) -> str:
    return "SCRIPT " + json.dumps(steps) + f" {tag}"


def start(w, a, stub, run_id: str, steps: list, *, flags=None, toolsets=None, **extra) -> None:
    w.send(harness.run_start(a, stub, run_id=run_id, conversation=f"c-{run_id}", text=script(steps, f"tag-{run_id}"),
                             toolsets=TOOLSETS if toolsets is None else toolsets, budgets={},
                             flags=dict(flags or {}), **extra))


def answer(w, a, run_id: str, request_id: str, answers: dict, outcome: str = "submitted", mid: str = "ca") -> None:
    w.send({"type": "clarify.answer", "id": mid, "account": a.account, "run": run_id, "request_id": request_id,
            "answers": answers, "outcome": outcome})


def clarify_events(seen: list[dict], kind: str) -> list[dict]:
    return [m["payload"] for m in seen if m.get("type") == "event" and m.get("kind") == kind]


def clarify_result(stub, tag: str) -> dict:
    """The clarify tool result the model read in the request after the call."""
    for r in reversed(stub.requests):
        if r["method"] != "POST" or tag not in json.dumps(r["body"].get("messages", [])):
            continue
        for m in r["body"]["messages"]:
            if m.get("role") == "tool" and '"responses"' in str(m.get("content")):
                return json.loads(m["content"])
    raise AssertionError(f"no clarify result for {tag}")


def until_request(w, a, run_id: str, timeout: float = 60.0) -> tuple[dict, list[dict]]:
    """Messages up to the run's clarify.request (answering tool.call on the way)."""
    seen = []
    while True:
        msg = w.recv(timeout)
        seen.append(msg)
        if msg.get("type") == "tool.call":
            w.send({"type": "tool.result", "id": msg["id"], "account": a.account,
                    **harness.go_answer(msg["name"], msg.get("args") or {})})
        if msg.get("type") == "event" and msg.get("kind") == "clarify.request" and msg.get("run") == run_id:
            return msg["payload"], seen
        assert msg.get("type") not in ("run.done", "__eof__"), seen


def test_clarify_answer_resumes_the_same_turn(cagent, cworker, stub):
    """The card carries the questions (choices without the "(Recommended)" label, the marked one
    as ``recommended``); the answer reaches the model as Hermes' ``user_response`` and the same
    turn finishes with one ``run.done``."""
    steps = [{"calls": [["clarify", PICK]]}, {"text": "Added to Home."}]
    start(cworker, cagent, stub, "ccl1", steps)
    request, seen = until_request(cworker, cagent, "ccl1")
    assert request["timeout_s"] == 600 and len(request["request_id"]) == 32, request
    assert request["questions"] == [
        {"qid": "q0", "question": "Which list should hold it?", "choices": ["Work", "Home", "Errands"],
         "recommended": 0, "multi_select": False},
        {"qid": "q1", "question": "Anything to add to the title?", "choices": None, "recommended": None,
         "multi_select": False}], request
    started = [m for m in seen if m.get("type") == "event" and m.get("kind") == "tool.started"]
    assert started and started[-1]["payload"]["tool"] == "clarify"
    answer(cworker, cagent, "ccl1", request["request_id"], {"q0": "Home", "q1": "from the shop"})
    done, rest = harness.drive(cworker, cagent.account, "ccl1")
    seen += rest
    assert {"type": "ack", "id": "ca", "ok": True, "account": cagent.account} in seen
    assert done["completed"] is True and done["interrupted"] is False and done["final_response"] == "Added to Home."
    assert clarify_events(seen, "clarify.closed") == [{"request_id": request["request_id"], "outcome": "submitted",
                                                       "answers": {"q0": "Home", "q1": "from the shop"}}]
    result = clarify_result(stub, "tag-ccl1")
    assert result["outcome"] == "submitted", result
    assert [r["user_response"] for r in result["responses"]] == ["Home", "from the shop"], result
    assert [r["status"] for r in result["responses"]] == ["answered", "answered"]
    assert len([m for m in seen if m.get("type") == "run.done"]) == 1


def test_clarify_multi_select_and_typed_answers(cagent, cworker, stub):
    """A multi-select question takes a list; a typed ("Other") answer to a single-select question
    is any text; an unanswered question reads as skipped."""
    q = {"questions": [{"question": "Which days?", "choices": ["Mon", "Tue", "Wed"], "multi_select": True},
                       {"question": "Which list?", "choices": ["Work", "Home"]},
                       {"question": "Due time?", "choices": ["9:00", "17:00"]}]}
    start(cworker, cagent, stub, "ccl2", [{"calls": [["clarify", q]]}, {"text": "ok"}])
    request, _ = until_request(cworker, cagent, "ccl2")
    assert request["questions"][0]["multi_select"] is True and request["questions"][0]["recommended"] == 0
    answer(cworker, cagent, "ccl2", request["request_id"],
           {"q0": ["Mon", "Wed"], "q1": "The garden list", "q2": None, "q9": "ignored"})
    done, _ = harness.drive(cworker, cagent.account, "ccl2")
    assert done["completed"] is True
    result = clarify_result(stub, "tag-ccl2")
    assert [r["user_response"] for r in result["responses"]] == [["Mon", "Wed"], "The garden list", None], result
    assert [r["status"] for r in result["responses"]] == ["answered", "answered", "skipped"], result


def test_clarify_late_answer_and_bad_answers(cagent, cworker, stub):
    """An answer after the wait closed gets ``ack ok: false``; a missing ``request_id`` or a bad
    shape is ``bad_message``; an answer naming another run never reaches this one."""
    start(cworker, cagent, stub, "ccl3", [{"calls": [["clarify", PICK]]}, {"text": "ok"}])
    request, _ = until_request(cworker, cagent, "ccl3")
    rid = request["request_id"]
    cworker.send({"type": "clarify.answer", "id": "bad1", "account": cagent.account, "run": "ccl3", "answers": {}})
    bad, _ = cworker.until("error")
    assert bad["code"] == "bad_message" and bad["id"] == "bad1", bad
    cworker.send({"type": "clarify.answer", "id": "bad2", "account": cagent.account, "run": "ccl3",
                  "request_id": rid, "answers": {"q0": 3}})
    bad, _ = cworker.until("error")
    assert bad["code"] == "bad_message" and bad["id"] == "bad2", bad
    answer(cworker, cagent, "other-run", rid, {"q0": "Work"}, mid="wrong-run")
    ack, _ = cworker.until("ack")
    assert ack == {"type": "ack", "id": "wrong-run", "ok": False, "account": cagent.account}, ack
    answer(cworker, cagent, "ccl3", rid, {"q0": "Work"}, mid="first")
    answer(cworker, cagent, "ccl3", rid, {"q0": "Home"}, mid="late")
    done, seen = harness.drive(cworker, cagent.account, "ccl3")
    acks = {m["id"]: m["ok"] for m in seen if m.get("type") == "ack"}
    assert acks == {"first": True, "late": False}, acks
    assert clarify_result(stub, "tag-ccl3")["responses"][0]["user_response"] == "Work"
    answer(cworker, cagent, "ccl3", rid, {"q0": "Home"}, mid="after-run")
    ack, _ = cworker.until("ack")
    assert ack["id"] == "after-run" and ack["ok"] is False, ack


def test_clarify_stop_cancels_the_wait_and_the_run(cagent, cworker, stub):
    start(cworker, cagent, stub, "ccl4", [{"calls": [["clarify", PICK]]}, {"text": "never"}])
    request, _ = until_request(cworker, cagent, "ccl4")
    cworker.send({"type": "run.stop", "id": "stop1", "account": cagent.account, "run": "ccl4", "reason": "stopped"})
    done, seen = harness.drive(cworker, cagent.account, "ccl4")
    assert done["interrupted"] is True and done["final_response"] != "never", done
    assert clarify_events(seen, "clarify.closed") == [{"request_id": request["request_id"], "outcome": "cancelled"}]
    answer(cworker, cagent, "ccl4", request["request_id"], {"q0": "Work"}, mid="after-stop")
    ack, _ = cworker.until("ack")
    assert ack["ok"] is False


def test_clarify_timeout_ends_the_wait_and_the_turn_completes(cagent, cworker, stub):
    """``clarify_timeout_s`` (Go sends 600): the wait ends ``timed_out`` with a notice the model
    reads, and the model finishes the turn."""
    t0 = time.monotonic()
    start(cworker, cagent, stub, "ccl5", [{"calls": [["clarify", PICK]]}, {"text": "I will ask again later."}],
          clarify_timeout_s=1)
    request, _ = until_request(cworker, cagent, "ccl5")
    assert request["timeout_s"] == 1
    done, seen = harness.drive(cworker, cagent.account, "ccl5")
    assert done["completed"] is True and done["final_response"] == "I will ask again later.", done
    assert clarify_events(seen, "clarify.closed") == [{"request_id": request["request_id"], "outcome": "timed_out"}]
    result = clarify_result(stub, "tag-ccl5")
    assert result["outcome"] == "timed_out" and "did not answer" in result["notice"], result
    assert [r["status"] for r in result["responses"]] == ["unanswered", "unanswered"]
    assert time.monotonic() - t0 < 30


def test_clarify_is_blocked_from_a_bot(cagent, cworker, stub):
    """Recursion guard: a run Go marks ``from_bot`` never asks (the call is blocked, no card)."""
    start(cworker, cagent, stub, "ccl6", [{"calls": [["clarify", PICK]]}, {"text": "decided"}],
          flags={"from_bot": True})
    done, seen = harness.drive(cworker, cagent.account, "ccl6")
    assert done["completed"] is True
    assert not clarify_events(seen, "clarify.request")
    assert not [m for m in seen if m.get("type") == "gate.ask"]  # decided in the worker
    results = [m["content"] for r in stub.requests if r["method"] == "POST"
               and "tag-ccl6" in json.dumps(r["body"].get("messages", []))
               for m in r["body"]["messages"] if m.get("role") == "tool"]
    assert results and "questions to the person are not available" in results[-1], results


def test_clarify_out_of_the_toolsets_is_never_offered(cagent, cworker, stub):
    """Without the ``clarify`` toolset (Go leaves it out of answer-only, bot and no-persist runs)
    the agent has no callback and no tool: Hermes answers that it does not exist."""
    start(cworker, cagent, stub, "ccl7", [{"calls": [["clarify", PICK]]}, {"text": "ok"}],
          toolsets=["timely", "todo"])
    done, seen = harness.drive(cworker, cagent.account, "ccl7")
    assert done["completed"] is True and not clarify_events(seen, "clarify.request")


def test_clarify_wait_outlasts_the_tool_batch_deadline(stub):
    """Hermes' tool batch deadline (1 s here, ``--batch-deadline``) times out a slow tool, but a
    question wait longer than it finishes: clarify runs inline, before any deadline is armed,
    inside Hermes' human-wait window."""
    a = harness.Agent(harness.new_root("ccl-dl"))
    argv = [harness.python(), "-I", str(HERE / "probe_boot.py"), "--batch-deadline", "1", "--sleep-tool", "worker"]
    w, ready = harness.ready_worker(a, argv=argv, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        start(w, a, stub, "ccl8a", [{"calls": [[probe_boot.SLEEP_TOOL, {"s": 3}]]}, {"text": "slept"}],
              toolsets=["probe"])
        done, _ = harness.drive(w, a.account, "ccl8a", verdict=("allow", ""))
        slow = [m["content"] for r in stub.requests if r["method"] == "POST"
                and "tag-ccl8a" in json.dumps(r["body"].get("messages", []))
                for m in r["body"]["messages"] if m.get("role") == "tool"]
        assert slow and "slept" not in slow[-1] and "time" in slow[-1].lower(), slow  # the deadline fired
        start(w, a, stub, "ccl8b", [{"calls": [["clarify", PICK]]}, {"text": "after a long wait"}])
        request, _ = until_request(w, a, "ccl8b")
        time.sleep(3)
        answer(w, a, "ccl8b", request["request_id"], {"q0": "Errands"})
        done, seen = harness.drive(w, a.account, "ccl8b")
        assert done["completed"] is True and done["final_response"] == "after a long wait", done
        assert clarify_events(seen, "clarify.closed")[0]["outcome"] == "submitted"
        assert clarify_result(stub, "tag-ccl8b")["responses"][0]["user_response"] == "Errands"
    finally:
        w.close()


def test_clarify_shutdown_cancels_the_wait(stub):
    """``shutdown`` while a card waits: the wait closes ``cancelled`` at once (the person cannot
    answer within the grace), the run ends interrupted, and the worker exits."""
    a = harness.Agent(harness.new_root("ccl-sd"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        start(w, a, stub, "ccl9", [{"calls": [["clarify", PICK]]}, {"text": "never"}])
        request, _ = until_request(w, a, "ccl9")
        t0 = time.monotonic()
        w.send({"type": "shutdown", "account": a.account, "grace": 20})
        done, seen = w.until("run.done", timeout=30)
        assert done["interrupted"] is True, done
        assert clarify_events(seen, "clarify.closed") == [{"request_id": request["request_id"], "outcome": "cancelled"}]
        assert time.monotonic() - t0 < 15
        assert w.proc.wait(30) == 0
    finally:
        w.close()

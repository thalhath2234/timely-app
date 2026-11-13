"""Sub-task contract tests (phase 4): ``delegate_task`` with Timely's caps, child-to-parent taint
and the ``subagent`` events, on real workers and the stub model.

The stub plays the parent from a ``SCRIPT`` list whose ``delegate_task`` call carries each child's
own ``SCRIPT`` as its goal (a child's first user message is its goal). Children run inside the
call (joined delegation) under their own session ids; their Timely calls reach Go under the
parent's run with ``subagent``, and their outside reads taint the parent with ``via: "subagent"``.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

import harness

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import test_c_web as web  # noqa: E402

TOOLSETS = ["timely", "todo", "delegation"]
CAP = "already used its 3 sub-tasks"
POOL = "The sub-task budget for this reply is used up"
PROPOSAL = {"summary": "Add a task", "steps": [{"tool": "create_task", "summary": "Add Buy milk",
                                                "arguments": {"title": "Buy milk"}}],
            "direct": True, "reply": "", "remaining": "", "language": "en"}


@pytest.fixture(scope="module")
def dagent():
    return harness.Agent(harness.new_root("cdg"))


@pytest.fixture(scope="module")
def dworker(dagent):
    w, ready = harness.ready_worker(dagent, hello={"timely_tools": harness.timely_tools()})
    assert ready["self_test"]["ok"], ready["self_test"]
    yield w
    w.close()


def script(steps: list, tag: str = "") -> str:
    return "SCRIPT " + json.dumps(steps) + (f" {tag}" if tag else "")


def child(steps: list, tag: str) -> dict:
    return {"goal": script(steps, tag)}


def run(w, a, stub, run_id: str, steps: list, *, toolsets=None, flags=None, verdict=("block", harness.BLOCK_MESSAGE),
        answer=harness.go_answer, conversation: str = "", **extra):
    w.send(harness.run_start(a, stub, run_id=run_id, conversation=conversation or f"c-{run_id}",
                             text=script(steps, f"tag-{run_id}"), toolsets=TOOLSETS if toolsets is None else toolsets,
                             budgets={}, flags=dict(flags or {}), **extra))
    return harness.drive(w, a.account, run_id, answer=answer, verdict=verdict, timeout=120)


def events(seen: list[dict], kind: str) -> list[dict]:
    return [m["payload"] for m in seen if m.get("type") == "event" and m.get("kind") == kind]


def child_request(request: dict, child_tag: str, parent_tag: str) -> bool:
    """A model request of the child whose goal ends with ``child_tag`` (not the parent's)."""
    users = [json.dumps(m.get("content")) for m in request["body"].get("messages", []) if m.get("role") == "user"]
    return any(child_tag in u for u in users) and not any(parent_tag in u for u in users)


def tool_texts(stub, marker: str) -> list[str]:
    """Every tool result in the stub's requests whose messages contain ``marker`` (each once)."""
    out: list[str] = []
    for r in stub.requests:
        if r["method"] != "POST" or marker not in json.dumps(r["body"].get("messages", [])):
            continue
        for m in r["body"]["messages"]:
            if m.get("role") == "tool":
                text = m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
                if text not in out:
                    out.append(text)
    return out


def test_three_children_run_and_report(dagent, dworker, stub):
    """A batch of three children runs inside the call: each Timely read reaches Go under the
    parent's run with ``subagent`` (the child's session id), each child has a ``subagent`` start and
    stop event, and a clean child adds no taint."""
    kids = [child([{"calls": [["get_task", {"id": f"t{i}"}]]}, {"text": f"found t{i}"}], f"kid-{i}") for i in range(3)]
    done, seen = run(dworker, dagent, stub, "cdg1", [{"calls": [["delegate_task", {"tasks": kids}]]},
                                                     {"text": "all three done"}])
    assert done["completed"] is True and done["final_response"] == "all three done", done
    starts = [e for e in events(seen, "subagent") if e["phase"] == "start"]
    stops = [e for e in events(seen, "subagent") if e["phase"] == "stop"]
    assert len(starts) == 3 and len(stops) == 3, events(seen, "subagent")
    sids = {e["child_session_id"] for e in starts}
    assert len(sids) == 3 and all(e["subagent_id"] and len(e["goal"]) <= 200 for e in starts), starts
    assert all(e["status"] == "completed" and e["tool_calls"] == 1 for e in stops), stops
    calls = [m for m in seen if m["type"] == "tool.call"]
    assert sorted(m["args"]["id"] for m in calls) == ["t0", "t1", "t2"], calls
    assert all(m["run"] == "cdg1" and m["subagent"] in sids for m in calls), calls
    assert done["tainted_sources"] == [] and not [m for m in seen if m["type"] == "taint"]
    assert "delegate_task" not in json.dumps(done["tainted_sources"])


def test_fourth_child_is_refused(dagent, dworker, stub):
    """Three children per run in total: a fourth in a later call of the same run, or four in one
    call, is refused with the cap message; the model reads it and nothing more runs."""
    two = [child([{"text": f"kid {i}"}], f"kid4-{i}") for i in range(2)]
    steps = [{"calls": [["delegate_task", {"tasks": two}]]},
             {"calls": [["delegate_task", {"goal": script([{"text": "third"}], "kid4-2")}]]},
             {"calls": [["delegate_task", {"tasks": [child([{"text": "fourth"}], "kid4-3")]}]]},
             {"text": "done"}]
    done, seen = run(dworker, dagent, stub, "cdg2", steps)
    assert done["completed"] is True
    assert len([e for e in events(seen, "subagent") if e["phase"] == "start"]) == 3
    texts = tool_texts(stub, "tag-cdg2")
    assert sum(CAP in t for t in texts) == 1, texts
    four = [child([{"text": f"kid {i}"}], f"kid5-{i}") for i in range(4)]
    done, seen = run(dworker, dagent, stub, "cdg3", [{"calls": [["delegate_task", {"tasks": four}]]}, {"text": "ok"}])
    assert not events(seen, "subagent") and any(CAP in t for t in tool_texts(stub, "tag-cdg3"))


def test_fourth_child_in_a_json_string_is_refused(dagent, dworker, stub):
    """``tasks`` as a JSON-array string is a batch to Hermes (it parses the string after the gate): the
    gate counts it the same way, so the cap holds for that shape too."""
    three = [child([{"text": f"kid {i}"}], f"kid6-{i}") for i in range(3)]
    steps = [{"calls": [["delegate_task", {"tasks": json.dumps(three)}]]},
             {"calls": [["delegate_task", {"tasks": json.dumps([child([{"text": "fourth"}], "kid6-3")])}]]},
             {"text": "done"}]
    done, seen = run(dworker, dagent, stub, "cdg3s", steps)
    assert done["completed"] is True
    assert len([e for e in events(seen, "subagent") if e["phase"] == "start"]) == 3
    assert sum(CAP in t for t in tool_texts(stub, "tag-cdg3s")) == 1


def test_tasks_that_are_not_an_array_are_refused(dagent, dworker, stub):
    for i, bad in enumerate(("not json", {"goal": "x"})):
        name = f"cdg3b{i}"
        done, seen = run(dworker, dagent, stub, name,
                         [{"calls": [["delegate_task", {"tasks": bad}]]}, {"text": "ok"}])
        assert done["completed"] is True and not events(seen, "subagent")
        assert any("needs tasks as an array" in t for t in tool_texts(stub, f"tag-{name}"))


def test_background_children_are_refused(dagent, dworker, stub):
    kid = child([{"text": "bg"}], "kid-bg")
    done, seen = run(dworker, dagent, stub, "cdg4",
                     [{"calls": [["delegate_task", {"tasks": [kid], "background": True}]]}, {"text": "ok"}])
    assert done["completed"] is True and not events(seen, "subagent")
    assert any("cannot run in the background" in t for t in tool_texts(stub, "tag-cdg4"))


def test_sub_tasks_are_never_given_images(dagent, dworker, stub, tmp_path):
    """``images`` (a URL or a local file) would reach the child's first message as outside content
    with no taint source: the call is refused, no child starts and no model request carries an image."""
    local = tmp_path / "passport.png"
    local.write_bytes(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"))
    pics = ["https://attacker.example/pixel.png?d=SECRET", str(local)]
    kid = dict(child([{"text": "saw it"}], "kid-img"), images=pics)
    done, seen = run(dworker, dagent, stub, "cdg4i", [{"calls": [["delegate_task", {"tasks": [kid]}]]},
                                                     {"calls": [["delegate_task", {"goal": "x", "images": pics}]]},
                                                     {"text": "ok"}])
    assert done["completed"] is True and not events(seen, "subagent") and done["tainted_sources"] == [], done
    assert sum("cannot be given images" in t for t in tool_texts(stub, "tag-cdg4i")) == 1
    bodies = json.dumps([r["body"] for r in stub.requests if r["method"] == "POST"])
    assert "image_url" not in bodies and "data:image" not in bodies and "Image attached" not in bodies


def test_sub_tasks_in_a_json_string_are_never_given_images(dagent, dworker, stub, tmp_path):
    """The same refusal when ``tasks`` arrives as a JSON-array string (Hermes parses it after the gate)."""
    local = tmp_path / "passport.png"
    local.write_bytes(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"))
    pics = ["https://attacker.example/pixel2.png?d=SECRET", str(local)]
    kid = dict(child([{"text": "saw it"}], "kid-strimg"), images=pics)
    done, seen = run(dworker, dagent, stub, "cdg4s", [{"calls": [["delegate_task", {"tasks": json.dumps([kid])}]]},
                                                     {"text": "ok"}])
    assert done["completed"] is True and not events(seen, "subagent") and done["tainted_sources"] == [], done
    assert sum("cannot be given images" in t for t in tool_texts(stub, "tag-cdg4s")) == 1
    bodies = json.dumps([r["body"] for r in stub.requests if r["method"] == "POST"])
    assert "image_url" not in bodies and "data:image" not in bodies and "Image attached" not in bodies


def test_shared_pool_blocks_the_61st_child_call(dagent, dworker, stub):
    """Every child of the run shares 60 tool calls; the 61st is blocked with the budget message."""
    def todo(i: int) -> list:
        return ["todo_list", {"todos": [{"id": str(i), "content": f"pool {i}", "status": "in_progress"}]}]
    kid = child([{"calls": [todo(i) for i in range(30)]}, {"calls": [todo(i) for i in range(30, 61)]},
                 {"text": "kid done"}], "kid-pool")
    done, seen = run(dworker, dagent, stub, "cdg5", [{"calls": [["delegate_task", {"tasks": [kid]}]]},
                                                     {"text": "ok"}])
    assert done["completed"] is True
    stop = [e for e in events(seen, "subagent") if e["phase"] == "stop"]
    assert stop and stop[0]["tool_calls"] == 60, stop
    kid_requests = [r for r in stub.requests if r["method"] == "POST" and child_request(r, "kid-pool", "tag-cdg5")]
    results = [m["content"] for m in kid_requests[-1]["body"]["messages"] if m.get("role") == "tool"]
    assert len(results) == 61 and sum(POOL in str(c) for c in results) == 1 and POOL in str(results[-1]), \
        [str(c)[:80] for c in results[-3:]]


def test_child_cannot_propose_and_its_proposal_never_reaches_go(dagent, dworker, stub):
    kid = child([{"calls": [["propose_changes", PROPOSAL]]}, {"calls": [["session_search", {"query": "x"}]]},
                 {"calls": [["skill_manage", {"action": "create", "name": "kid-skill", "content": "x"}]]},
                 {"text": "kid done"}], "kid-prop")
    done, seen = run(dworker, dagent, stub, "cdg6", [{"calls": [["delegate_task", {"tasks": [kid]}]]}, {"text": "ok"}],
                     toolsets=TOOLSETS + ["skills", "session_search"])
    assert done["completed"] is True
    assert not [m for m in seen if m["type"] in ("tool.call", "gate.ask")], seen
    texts = tool_texts(stub, "kid-prop")
    assert any("only the main assistant proposes" in t for t in texts), texts
    assert any("cannot search past chats" in t for t in texts), texts
    assert any("cannot save skills" in t for t in texts), texts
    assert not (dagent.home / "skills" / "kid-skill").exists()


def test_subtasks_are_refused_from_a_bot_and_without_persistence(dagent, dworker, stub):
    """Recursion guard: a ``from_bot`` run never starts sub-tasks; a no-persist run cannot even be
    given the ``delegation`` toolset (``bad_message``)."""
    kid = child([{"text": "never"}], "kid-bot")
    done, seen = run(dworker, dagent, stub, "cdg7", [{"calls": [["delegate_task", {"tasks": [kid]}]]}, {"text": "ok"}],
                     flags={"from_bot": True})
    assert done["completed"] is True and not events(seen, "subagent")
    assert any("sub-tasks are not available here" in t for t in tool_texts(stub, "tag-cdg7"))
    dworker.send(harness.run_start(dagent, stub, run_id="cdg8", conversation="c-cdg8", toolsets=TOOLSETS,
                                   flags={"no_persist": True}, text="hi"))
    err, _ = dworker.until("error")
    assert err["code"] == "bad_message" and err.get("run") == "cdg8" and "no-persist" in err["message"], err


def test_child_web_read_taints_the_parent_and_holds_its_proposal(stub):
    """A child's ``web_extract`` of a page adds ``{kind, tool, host, via: "subagent", child}`` to the
    parent's taint at once (``taint``), its call reaches Go with ``subagent``, the parent's next
    proposal carries the source (Go holds it), and ``run.done`` lists it."""
    root = harness.new_root("cdg-web")
    a = harness.Agent(root)
    w, _log = web._start(a, root)
    kid = child([{"calls": [["web_extract", {"urls": [web.NEWS]}]]}, {"text": "kid read it"}], "kid-web")
    try:
        done, seen = run(w, a, stub, "cdg9", [{"calls": [["delegate_task", {"tasks": [kid]}]]},
                                              {"calls": [["propose_changes", PROPOSAL]]}, {"text": "done"}],
                         toolsets=TOOLSETS + ["web"], flags={"web": True}, verdict=("allow", ""),
                         answer=web.answer({web.NEWS: "Breaking news from the page."}))
    finally:
        w.close()
    sid = [e for e in events(seen, "subagent") if e["phase"] == "start"][0]["child_session_id"]
    extract = [m for m in seen if m["type"] == "tool.call" and m["name"] == "web_extract"]
    assert extract and extract[0]["subagent"] == sid, extract
    host = {"kind": "web", "tool": "web_extract", "host": "news.example", "via": "subagent", "child": sid}
    taints = [s for m in seen if m["type"] == "taint" for s in m["sources"]]
    assert host in taints and all(s.get("via") == "subagent" and s.get("child") == sid for s in taints), taints
    first_taint = next(i for i, m in enumerate(seen) if m["type"] == "taint")
    stop = next(i for i, m in enumerate(seen) if m.get("kind") == "subagent" and m["payload"]["phase"] == "stop")
    assert first_taint < stop  # sent at once, not at the end of the child
    proposal = [m for m in seen if m["type"] == "tool.call" and m["name"] == "propose_changes"]
    assert proposal and "subagent" not in proposal[0] and host in proposal[0]["tainted_sources"], proposal
    assert host in done["tainted_sources"], done["tainted_sources"]


def test_deleting_the_chat_deletes_its_child_sessions(dagent, dworker, stub):
    kids = [child([{"calls": [["get_task", {"id": "d"}]]}, {"text": "kid"}], f"kid-del-{i}") for i in range(2)]
    conv = "c-cdg-del"
    done, seen = run(dworker, dagent, stub, "cdg10", [{"calls": [["delegate_task", {"tasks": kids}]]}, {"text": "ok"}],
                     conversation=conv)
    sids = {e["child_session_id"] for e in events(seen, "subagent") if e["phase"] == "start"}
    db = dagent.home / "state.db"

    def rows() -> set[str]:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            return {r[0] for r in con.execute("SELECT id FROM sessions WHERE id = ? OR parent_session_id = ?",
                                              (conv, conv))}
        finally:
            con.close()

    assert len(sids) == 2 and sids | {conv} <= rows(), (sids, rows())
    record = json.loads((dagent.home / ".timely" / "delegations.json").read_text(encoding="utf-8"))
    live = [dagent.home / "cache" / "delegation" / "live" / n for n in record[conv]]
    assert live and all(p.is_dir() for p in live), record
    dworker.send({"type": "session.delete", "id": "del1", "account": dagent.account, "conversation_id": conv})
    ack, _ = dworker.until("ack")
    assert ack["ok"] is True, ack
    assert rows() == set()
    assert not any(p.exists() for p in live)
    assert conv not in json.loads((dagent.home / ".timely" / "delegations.json").read_text(encoding="utf-8"))


def test_agent_forget_removes_a_deleted_chats_subtask_transcripts(stub):
    """A chat deleted while the account had no worker (``agent-forget``): its child sessions and
    their live transcripts leave the home too."""
    a = harness.Agent(harness.new_root("cdg-forget"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    conv = "c-cdg-forget"
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        run(w, a, stub, "cdg11", [{"calls": [["delegate_task", {"tasks": [child([{"text": "kid"}], "kid-fg")]}]]},
                                  {"text": "ok"}], conversation=conv)
    finally:
        w.close()
    record = json.loads((a.home / ".timely" / "delegations.json").read_text(encoding="utf-8"))
    live = [a.home / "cache" / "delegation" / "live" / n for n in record[conv]]
    assert live and all(p.is_dir() for p in live)
    ids = a.root / "forget.json"
    ids.write_text(json.dumps([conv]), encoding="utf-8")
    out = harness.run_cli("agent-forget", a.dir, None, "--account", a.account, "--sessions", str(ids))
    assert out["ok"] is True and out["gone"] == [conv], out
    assert not any(p.exists() for p in live)
    con = sqlite3.connect(f"file:{a.home / 'state.db'}?mode=ro", uri=True)
    try:
        assert con.execute("SELECT COUNT(*) FROM sessions WHERE parent_session_id = ?", (conv,)).fetchone()[0] == 0
    finally:
        con.close()

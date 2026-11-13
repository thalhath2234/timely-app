"""No-persist contract tests (phase 4, Q-4.2): ``run.start.flags.no_persist`` leaves nothing of the
run in the account home. Sensitive and photo chats stay on classic (the flag is test-only and off
by default in Go); this proves the worker half: no ``state.db`` rows, no memory, no learning, no
counters, no log lines, no request dumps, and nothing a past-chat search can find.

The proof is a snapshot of the home (every path with its size, mode, mtime and sha256) before and
after two no-persist turns with tool calls. On a home that has served the model endpoint before
(every real Sensitive turn: the account's chats used it), nothing changes. On a cold home Hermes
records what it learned about the endpoint (its server type, the model's context length), which
holds no text of the chat; that residue is listed exactly below.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import sys
from pathlib import Path

import harness

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

NP = {"no_persist": True, "sensitive": True}
TOOLSETS = ["timely", "todo"]
SECRET = "zebrafinch-np-4471"
# What Hermes writes about a model endpoint the home never saw (no chat text): the local server
# probe, the context length cache and its lock, and the hourly scratch prune stamp.
ENDPOINT_METADATA = {"cache", "cache/local_endpoint_probes.json", "cache/scratch", "cache/scratch/.last_prune",
                     "context_length_cache.yaml", "context_length_cache.yaml.lock"}


def snapshot(home: Path) -> dict[str, tuple]:
    out = {}
    for root, dirs, files in os.walk(home):
        for name in dirs + files:
            p = Path(root) / name
            st = p.lstat()
            digest = hashlib.sha256(p.read_bytes()).hexdigest() if stat.S_ISREG(st.st_mode) else ""
            out[p.relative_to(home).as_posix()] = (st.st_size, st.st_mode, st.st_mtime_ns, digest)
    return out


def changed(before: dict, after: dict) -> list[str]:
    return sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))


def two_turns(w, a, stub, conv: str, run_prefix: str) -> list[dict]:
    """Two no-persist turns of one chat, each with a tool call, the second with the first in its
    ``history`` (Go sends the whole conversation every turn). Returns every message."""
    seen_all: list[dict] = []
    history: list[dict] = []
    todo = json.dumps({"todos": [{"id": "1", "content": f"{SECRET} list", "status": "in_progress"}]})
    for i, text in enumerate((f"CALL todo_list {todo}", f'CALL get_task {{"id": "{SECRET}"}}')):
        msg = harness.run_start(a, stub, run_id=f"{run_prefix}{i}", conversation=conv, text=text, budgets={},
                                toolsets=TOOLSETS, flags=dict(NP), history=list(history))
        w.send(msg)
        done, seen = harness.drive(w, a.account, f"{run_prefix}{i}")
        assert done["completed"] is True and "error" not in done, done
        assert done["history_seeded"] is False
        seen_all += seen
        history += [{"role": "user", "content": text}, {"role": "assistant", "content": done["final_response"]}]
    return seen_all


def session_rows(home: Path) -> int:
    con = sqlite3.connect(f"file:{home / 'state.db'}?mode=ro", uri=True)
    try:
        return con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    finally:
        con.close()


def test_no_persist_turns_leave_the_home_unchanged(stub):
    a = harness.Agent(harness.new_root("cnp"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        # A normal chat of the account first (the home has served this endpoint; learning on).
        w.send(harness.run_start(a, stub, run_id="cnp-warm", conversation="c-warm", text="hello there", budgets={},
                                 toolsets=["timely", "todo", "memory"], flags={"learning_writes": True}))
        harness.drive(w, a.account, "cnp-warm")
        rows = session_rows(a.home)
        before = snapshot(a.home)
        seen = two_turns(w, a, stub, "c-np", "cnp")
        after = snapshot(a.home)
        assert changed(before, after) == [], changed(before, after)  # logs/agent.log included
        assert session_rows(a.home) == rows
        assert not [m for m in seen if m.get("type") == "learning"], "a no-persist run reported learning"
        # Go's history reached the model on the second turn (no state.db to read it from).
        users = [[str(m.get("content")) for m in r["body"]["messages"] if m.get("role") == "user"]
                 for r in stub.requests if r["method"] == "POST"]
        second = [u for u in users if u and u[-1].startswith("CALL get_task") and SECRET in u[-1]]
        assert second and any(x.startswith("CALL todo_list") for x in second[0][:-1]), \
            "the first turn was not in the second's history"
        # Another chat's past-chat search finds nothing of it, even with the chat listed as searchable.
        script = [{"calls": [["session_search", {"query": SECRET}]]},
                  {"calls": [["session_search", {"query": "hello there"}]]}, {"text": "searched"}]
        w.send(harness.run_start(a, stub, run_id="cnp-search", conversation="c-search", budgets={},
                                 text="SCRIPT " + json.dumps(script) + " tag-cnp-search",
                                 toolsets=["timely", "todo", "memory", "session_search"],
                                 flags={"learning_writes": True, "search_history": True},
                                 search_allow=["c-np", "c-warm", "c-search"]))
        harness.drive(w, a.account, "cnp-search")
        last = [r for r in stub.requests if r["method"] == "POST"
                and "tag-cnp-search" in json.dumps(r["body"]["messages"])][-1]
        results = [m["content"] for m in last["body"]["messages"] if m.get("role") == "tool"]
        assert len(results) == 2, results
        found = [json.loads(r) for r in results]
        assert found[0]["results"] == [] and "c-np" not in results[0], results[0]
        assert "c-warm" in results[1], results[1]  # the control: a persisted chat is found
    finally:
        w.close()


def test_no_persist_on_a_cold_home_writes_only_endpoint_metadata(stub):
    """A home that never served the endpoint: the only paths that change are Hermes' notes about
    the endpoint and model, and none of them holds the chat's text."""
    a = harness.Agent(harness.new_root("cnp-cold"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        before = snapshot(a.home)
        two_turns(w, a, stub, "c-np-cold", "cnpc")
        after = snapshot(a.home)
    finally:
        w.close()
    diff = changed(before, after)
    assert set(diff) <= ENDPOINT_METADATA, set(diff) - ENDPOINT_METADATA
    for rel in diff:
        p = a.home / rel
        if p.is_file():
            assert SECRET not in p.read_text(encoding="utf-8", errors="replace"), rel
    assert not (a.home / "state.db").exists() or session_rows(a.home) == 0


def test_no_persist_never_writes_a_request_dump(stub):
    """Hermes writes a refused request's whole body to ``sessions/request_dump_*.json``; a normal
    turn does (the control), a no-persist turn does not."""
    a = harness.Agent(harness.new_root("cnp-dump"))
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    sessions = a.home / "sessions"
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        w.send(harness.run_start(a, stub, run_id="cnpd-0", conversation="c-dump", text="REFUSE 400 control",
                                 toolsets=TOOLSETS, budgets={}))
        harness.drive(w, a.account, "cnpd-0")
        assert list(sessions.glob("request_dump_c-dump_*.json")), "the control turn wrote no dump"
        w.send(harness.run_start(a, stub, run_id="cnpd-1", conversation="c-dump-np",
                                 text=f"REFUSE 400 {SECRET}", toolsets=TOOLSETS, budgets={}, flags=dict(NP)))
        done, _ = harness.drive(w, a.account, "cnpd-1")
        assert done["completed"] is False, done
    finally:
        w.close()
    assert not list(sessions.glob("request_dump_c-dump-np_*.json"))
    assert not [p for p in a.home.rglob("*") if p.is_file() and SECRET in p.read_text("utf-8", errors="replace")]


def test_no_persist_takes_only_the_timely_and_todo_toolsets(stub):
    a = harness.Agent(harness.new_root("cnp-ts"))
    w, ready = harness.ready_worker(a)
    try:
        for i, extra in enumerate((["memory"], ["session_search"], ["clarify"], ["web"], ["skills"])):
            w.send(harness.run_start(a, stub, run_id=f"cnpt{i}", conversation=f"c-cnpt{i}", toolsets=TOOLSETS + extra,
                                     flags=dict(NP)))
            err, _ = w.until("error")
            assert err["code"] == "bad_message" and err.get("run") == f"cnpt{i}" and "no-persist" in err["message"], err
    finally:
        w.close()

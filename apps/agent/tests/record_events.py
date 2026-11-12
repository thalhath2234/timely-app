"""Record worker event fixtures for the Go engine's tests (phase 2 verification).

    <agent venv python> -I apps/agent/tests/record_events.py --out <dir> [--only <name>,...]

Runs the real worker (``boot.py worker``, started as Go starts it) against the stub model
(``stub_openai.py``, 127.0.0.1 only, no live provider) with a minimal Go stand-in that answers
``tool.call`` (``harness.go_answer``) and ``gate.ask`` (``block``, "That isn't available in
Timely yet", phase 2's verdict) and sends run controls. For each scenario it writes
``<dir>/<name>.jsonl``: every worker -> Go line of that run, in order, from ``run.start`` to its
``run.done`` (heartbeats and logs left out), including the top-level ``learning`` messages the
phase 3 scenarios produce (not run-scoped: they carry no ``run``). ``<dir>/manifest.json`` records, per scenario, the
``run.start`` sent (model credentials removed), what Go answered and when it sent controls, so
a replay knows which lines wait for an answer.

Run ids are ``run-<name>``, start ids ``start-<name>``, the account ``fixture-user`` and the
conversation ``conv-<name>``; a replay substitutes its own. Token counts, ``turn_id`` suffixes
and the number of ``delta`` lines vary between recordings; everything else is deterministic.

``make agent-record-fixtures OUT=<dir>`` runs this script.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

import harness  # noqa: E402
from stub_openai import StubServer  # noqa: E402

ACCOUNT = "fixture-user"
SKIP = ("heartbeat", "log", "ready")
PROPOSAL = {"summary": "Add the task Buy milk to Inbox", "direct": False, "reply": "", "remaining": "",
            "language": "en", "steps": [{"tool": "create_task", "summary": "Add Buy milk",
                                         "arguments": {"title": "Buy milk"}}]}


LEARN = {"learning_writes": True}
SKILL = "---\nname: fixture-sorting\ndescription: How the person sorts lists.\n---\n# Sorting\n\n1. Sort by aisle.\n"


def _script(*steps) -> str:
    return "SCRIPT " + json.dumps(list(steps))


def scenarios() -> list[dict]:
    """Each: name, description, user text, optional toolsets/extra run.start fields, controls."""
    direct = dict(PROPOSAL, direct=True)
    return [
        {"name": "plain_reply_deltas", "text": "STREAM 900 3 2",
         "description": "A plain reply streamed in small chunks: coalesced delta events, then run.done."},
        {"name": "read_tool_then_reply", "text": 'CALL get_task {"id": "task-1"}',
         "description": "One Timely read: tool.started, tool.call (batch_size 1), Go's result, the reply."},
        {"name": "propose_then_closing_sentence",
         "text": _script({"calls": [["propose_changes", PROPOSAL]]},
                         {"text": "I drafted adding Buy milk for you to approve."}),
         "description": "propose_changes alone; Go answers end_turn: true; the model writes one closing "
                        "sentence and the turn ends (Q-2.4)."},
        {"name": "propose_then_tool_call_ends_turn",
         "text": _script({"calls": [["propose_changes", PROPOSAL]]},
                         {"text": "Drafted it.", "calls": [["get_context", {}]]}, {"text": "never sent"}),
         "description": "After end_turn the model calls another tool: the gate blocks it (no tool.call) and "
                        "run.done has turn_exit_reason end_turn, interrupted false, the closing text kept."},
        {"name": "outside_read_then_direct_proposal",
         "text": _script({"calls": [["ask_bot", {"bot": "price-watch", "question": "What is the price?"}]]},
                         {"calls": [["propose_changes", direct]]}, {"text": "I drafted the change."}),
         "description": "An outside Timely read (Go answers outside: true) sends taint; the direct=true "
                        "proposal's tool.call carries tainted_sources, so Go holds it (approval)."},
        {"name": "propose_in_a_batch_is_blocked",
         "text": _script({"calls": [["propose_changes", PROPOSAL], ["get_context", {}]]},
                         {"text": "Let me read first and propose after."}),
         "description": "propose_changes next to a read in one message: blocked by timely_gate (never "
                        "reaches Go); the read's tool.call has batch_size 2, sibling_tools [propose_changes]."},
        {"name": "stop_mid_stream", "text": "STREAM 4000 2 5", "stop_after_delta": True,
         "description": "run.stop after the first delta: run.done with interrupted true."},
        {"name": "steer_mid_run",
         "text": _script({"calls": [["get_task", {"id": "task-1"}]]}),
         "steer_on_tool_call": "STEER also add eggs",
         "description": "run.steer while a tool.call waits on Go: ack ok, the reply follows the steer."},
        {"name": "blocked_non_timely_tool", "toolsets": harness.PHASE2_TOOLSETS + ["clarify"],
         "text": 'CALL clarify {"question": "Which list?", "choices": ["Groceries", "Work"]}',
         "description": "A Hermes tool outside the local allow list and the timely toolset (clarify, "
                        "offered here only to reach the gate; phase 3 decides session_search in the worker): "
                        "gate.ask, Go's block verdict, the model replies with the block message."},
        {"name": "learning_skill_applied", "toolsets": harness.PHASE2_TOOLSETS + ["memory"], "flags": LEARN,
         "text": _script({"calls": [["skill_manage", {"action": "create", "name": "fixture-sorting",
                                                       "content": SKILL}]]}, {"text": "Saved how you sort lists."}),
         "description": "Phase 3, a clean chat with learning on: skill_manage creates a skill; a top-level "
                        "learning message (status applied, origin chat, ledger_entry_id) comes before run.done."},
        {"name": "learning_skill_staged", "toolsets": harness.PHASE2_TOOLSETS + ["memory"], "flags": LEARN,
         "tainted_sources": [{"kind": "web", "tool": "web_extract", "host": "news.example"}],
         "text": _script({"calls": [["skill_manage", {"action": "create", "name": "fixture-tainted",
                                                       "content": SKILL.replace("sorting", "tainted")}]]},
                         {"text": "I saved it for you to confirm."}),
         "description": "Phase 3, a tainted chat: the same write is staged (learning status staged, pending_id); "
                        "the model reads 'Saved for the person to confirm in Timely; do not retry.'"},
        {"name": "learning_memory_added", "toolsets": harness.PHASE2_TOOLSETS + ["memory"], "flags": LEARN,
         "text": _script({"calls": [["memory", {"target": "user", "operations": [
             {"action": "add", "content": "Prefers short replies."}]}]]}, {"text": "Noted."}),
         "description": "Phase 3: a memory add in a clean chat (learning kind user, action added, applied)."},
        {"name": "unoffered_tool", "text": 'CALL terminal {"command": "ls"}',
         "description": "A tool not in the run's toolsets (terminal): Hermes refuses it itself; no gate.ask, "
                        "no tool.call."},
    ]


def record(out: Path, only: set[str] | None = None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    stub = StubServer().start()
    agent = harness.Agent(harness.new_root("fixtures"), account=ACCOUNT)
    worker, ready = harness.ready_worker(agent, hello={"timely_tools": harness.timely_tools()})
    manifest: dict = {"account": ACCOUNT, "catalog_version": ready.get("timely_tools", {}).get("catalog_version"),
                      "hermes_tag": ready.get("hermes_tag"), "scenarios": {}}
    try:
        if not ready["self_test"]["ok"]:
            raise SystemExit(f"worker self-test failed: {ready['self_test']['failures']}")
        for sc in scenarios():
            if only and sc["name"] not in only:
                continue
            name = sc["name"]
            run_id = f"run-{name}"
            start = harness.run_start(agent, stub, run_id=run_id, text=sc["text"], conversation=f"conv-{name}",
                                      toolsets=sc.get("toolsets", harness.PHASE2_TOOLSETS), budgets={},
                                      permission="supervised", flags=dict(sc.get("flags") or {"learning_writes": False}),
                                      tainted_sources=list(sc.get("tainted_sources") or []))
            start["id"] = f"start-{name}"
            controls: list[dict] = []
            answers: list[dict] = []

            def on_message(msg, sc=sc, name=name, run_id=run_id, controls=controls):
                t = msg.get("type")
                if sc.get("stop_after_delta") and t == "event" and msg.get("kind") == "delta" and not controls:
                    ctl = {"type": "run.stop", "id": f"stop-{name}", "account": ACCOUNT, "run": run_id, "reason": "user"}
                    controls.append({"after_line": "first delta", **ctl})
                    worker.send(ctl)
                if sc.get("steer_on_tool_call") and t == "tool.call" and not controls:
                    ctl = {"type": "run.steer", "id": f"steer-{name}", "account": ACCOUNT, "run": run_id,
                           "text": sc["steer_on_tool_call"]}
                    controls.append({"after_line": "first tool.call", **ctl})
                    worker.send(ctl)

            def answer(tool, args, answers=answers):
                reply = harness.go_answer(tool, args)
                answers.append({"tool": tool, **reply})
                return reply

            first = len(worker.raw_lines)
            worker.send(start)
            done, _ = harness.drive(worker, ACCOUNT, run_id, answer=answer, on_message=on_message, timeout=120)
            lines = [json.loads(raw) for raw in worker.raw_lines[first:]]
            lines = [m for m in lines if m.get("type") not in SKIP]
            end = next(i for i, m in enumerate(lines) if m.get("type") == "run.done" and m.get("run") == run_id)
            with open(out / f"{name}.jsonl", "w", encoding="utf-8") as f:
                for m in lines[:end + 1]:
                    f.write(json.dumps(m, sort_keys=True, ensure_ascii=False) + "\n")
            sent = {k: v for k, v in start.items() if k != "model"}
            sent["model"] = {k: v for k, v in start["model"].items() if k not in ("api_key", "base_url")}
            manifest["scenarios"][name] = {
                "description": sc["description"], "run_start": sent, "tool_results": answers,
                "gate_verdict": {"verdict": "block", "message": harness.BLOCK_MESSAGE}, "controls": controls,
                "run_done": {k: done.get(k) for k in ("completed", "interrupted", "turn_exit_reason", "final_response",
                                                      "tainted_sources")},
            }
            print(f"{name}: {end + 1} lines, {done.get('turn_exit_reason')}", file=sys.stderr)
    finally:
        worker.close()
        stub.shutdown()
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                                       encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--out", required=True, type=Path, help="folder for <scenario>.jsonl and manifest.json")
    parser.add_argument("--only", default="", help="comma-separated scenario names")
    args = parser.parse_args(argv)
    only = {n.strip() for n in args.only.split(",") if n.strip()} or None
    try:
        record(args.out.resolve(), only)
    finally:
        import os
        if os.environ.get("TIMELY_AGENT_KEEP") != "1" and harness.TEST_ROOT.exists():
            from timely_agent.seed import remove_tree
            remove_tree(harness.TEST_ROOT)
    return 0


if __name__ == "__main__":
    sys.exit(main())

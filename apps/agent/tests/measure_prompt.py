"""Phase 2 measurements behind two managed floors (``timely_agent/README.md`` records the numbers).

    <agent venv python> -I apps/agent/tests/measure_prompt.py [tool_search] [context_engine]

Both run real workers against the stub model only (127.0.0.1, no live provider).

**tool_search** (plan 1.4): the full Timely spec list (``fixtures/timely_tools.json``, 49 tools) with
the chat toolsets, ``tools.tool_search.enabled`` forced ``off`` or ``on`` through
``contract/probe_boot.py --tool-search``. Per mode: request bytes of turn 1 and turn 2 (a second
message on the same conversation), the ``tools`` array (count, bytes), tokens at 4 bytes a token,
and whether a direct ``get_task`` call reaches Go as ``tool.call``.

**context_engine** (plan 2): the context engines Hermes can load (``plugins.context_engine``) and
a long conversation on the built-in compressor (64K context, the stub reporting real usage):
request bytes per turn, compactions and summary side calls.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent), str(HERE / "contract")]

import harness  # noqa: E402
import probe_boot  # noqa: E402
from stub_openai import StubServer  # noqa: E402
from timely_agent import paths  # noqa: E402


def _posts(stub, marker):
    out = []
    for r in stub.requests:
        if r["method"] != "POST" or not r["path"].endswith("/chat/completions"):
            continue
        users = [m for m in r["body"].get("messages", []) if m.get("role") == "user"]
        if users and marker in json.dumps(users[-1].get("content")):
            out.append(r)
    return out


def tool_search() -> dict:
    results = {}
    for mode in ("off", "on"):
        stub = StubServer().start()
        a = harness.Agent(harness.new_root(f"ts-{mode}"))
        argv = [harness.python(), "-I", str(probe_boot.__file__), "--tool-search", mode, "worker"]
        w, ready = harness.ready_worker(a, argv=argv, hello={"timely_tools": harness.timely_tools()})
        row: dict = {"self_test_ok": ready["self_test"]["ok"]}
        try:
            for i, text in enumerate((f"ts-{mode} first message", f"ts-{mode} second message")):
                w.send(harness.run_start(a, stub, run_id=f"ts-{mode}-{i}", conversation=f"c-ts-{mode}",
                                         toolsets=harness.PHASE2_TOOLSETS, budgets={}, text=text))
                harness.drive(w, a.account, f"ts-{mode}-{i}")
                req = _posts(stub, text)[-1]
                tools = req["body"].get("tools") or []
                names = [(t.get("function") or {}).get("name") for t in tools]
                row[f"turn{i + 1}"] = {
                    "request_bytes": req["bytes"], "approx_tokens": req["bytes"] // 4,
                    "tools": len(tools), "tools_bytes": len(json.dumps(tools, separators=(",", ":"))),
                    "system_bytes": len(json.dumps(req["body"]["messages"][0].get("content"))),
                    "timely_tools_listed": sum(1 for n in names if n in {t["name"] for t in harness.timely_tools()["tools"]}),
                    "bridge_tools": [n for n in names if n in ("tool_search", "tool_describe", "tool_call")],
                }
            w.send(harness.run_start(a, stub, run_id=f"ts-{mode}-call", conversation=f"c-ts-{mode}-call",
                                     toolsets=harness.PHASE2_TOOLSETS, budgets={}, text='CALL get_task {"id": "t1"}'))
            done, seen = harness.drive(w, a.account, f"ts-{mode}-call")
            row["direct_get_task_reached_go"] = any(m["type"] == "tool.call" and m["name"] == "get_task" for m in seen)
            row["direct_get_task_reply"] = done["final_response"][:160]
        finally:
            w.close()
            stub.shutdown()
        results[mode] = row
    return results


ENGINES = """
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
from plugins.context_engine import discover_context_engines
from hermes_cli.config import load_config
print(json.dumps({"engines": [list(e) for e in discover_context_engines()],
                  "configured": (load_config().get("context") or {}).get("engine")}))
"""


def context_engine() -> dict:
    import hashlib
    stub = StubServer(context_length=64000, real_usage=True).start()
    a = harness.Agent(harness.new_root("ce"))
    proc = subprocess.run([harness.python(), "-I", "-c", ENGINES, str(paths.hermes_dir()), str(paths.agent_dir())],
                          capture_output=True, text=True, env=a.env(), timeout=180)
    found = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.returncode == 0 else {"error": proc.stderr[-500:]}
    w, ready = harness.ready_worker(a)
    turns, statuses = [], []
    try:
        for i in range(10):
            words = " ".join(hashlib.sha1(f"{i}-{j}".encode()).hexdigest()[:8] for j in range(2500))
            before = len(stub.requests)
            w.send(harness.run_start(a, stub, run_id=f"ce-{i}", conversation="c-ce", budgets={}, text=f"turn {i} {words}"))
            done, seen = harness.drive(w, a.account, f"ce-{i}", timeout=180)
            posts = [r for r in stub.requests[before:] if r["method"] == "POST"]
            turn_posts = [r for r in posts if str((r["body"]["messages"] or [{}])[0].get("content", "")).startswith("You are Timely")]
            statuses += [m["payload"]["kind"] for m in seen if m.get("type") == "event" and m.get("kind") == "status"]
            turns.append({"turn": i + 1, "request_bytes": [r["bytes"] for r in turn_posts],
                          "side_calls": len(posts) - len(turn_posts),
                          "side_call_bytes": [r["bytes"] for r in posts if r not in turn_posts],
                          "compacted": sum(1 for m in seen if m.get("type") == "event" and m.get("kind") == "status"
                                           and m["payload"]["kind"] == "compacted")})
    finally:
        w.close()
        stub.shutdown()
    return {"discovery": found, "turns": turns}


def main(argv: list[str]) -> int:
    which = argv or ["tool_search", "context_engine"]
    out = {}
    try:
        if "tool_search" in which:
            out["tool_search"] = tool_search()
        if "context_engine" in which:
            out["context_engine"] = context_engine()
    finally:
        if harness.TEST_ROOT.exists():
            from timely_agent.seed import remove_tree
            remove_tree(harness.TEST_ROOT)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Phase 6 contract test (Q-B2, PROTOCOL.md 13.4): a Bot's script tool parks in Needs you while the tick
goes on, and Run once runs it exactly once.

A real worker and the stub model. The tick calls ``bot_browser_exec``; the Go stand-in answers the
``gate.ask`` (``bot.park: true``) with ``approve`` and keeps the card, as Go writes it on the Bot thread;
the tick still reports and ends. Then a continuation (``bot.run`` with ``pre_approved`` naming exactly
that call) runs the script once, with no ``gate.ask``, through Hermes' ``browser_exec`` handler path on
the real-profile session (``local=True``), and a second identical call in it parks again.

Safety: no browser starts. The worker's wrapper replaces ``timely_bot.script.EXEC_FN`` with a fake that
appends each call to a log, and its real home is a throwaway folder under ``$HOME/.cache/p6-sandbox``.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import pytest

import harness
import stub_openai
from stub_openai import StubServer
from timely_agent import policy

HERE = Path(__file__).resolve().parent
AGENT_DIR = HERE.parent.parent
SANDBOX = Path.home() / ".cache" / "p6-sandbox" / f"pytest-script-{os.getpid()}"
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX sandbox paths")

# The worker's boot wrapper: the fake browser goes in before Hermes loads, then the real boot path runs.
BOOT = """
import json, sys
sys.path.insert(0, {contract!r})
sys.path.insert(0, {agent!r})
from timely_agent.plugins.timely_bot import script as _script
def _fake_exec(**kw):
    with open({log!r}, "a", encoding="utf-8") as f:
        f.write(json.dumps({{k: v for k, v in kw.items() if k != "task_id"}}) + "\\n")
    return json.dumps({{"success": True, "output": "ORDER-PLACED"}})
_script.EXEC_FN = _fake_exec
import probe_boot
sys.exit(probe_boot.main(sys.argv[1:]))
"""
CODE = "new_tab('https://www.amazon.in/gp/cart')\nwait_for_load()\nclick('#buy-now')\nprint(page_info())"
ARGS = {"code": CODE}
CARD = "Use your browser?"


class BotHandler(stub_openai.Handler):
    """Plays a ``SCRIPT [...]`` found anywhere in the tick's prompt (it starts with skills and the cron hint)."""

    def _answer(self, body: dict, raw: bytes) -> None:
        msgs = [dict(m) for m in body.get("messages") or []]
        for m in reversed(msgs):
            if m.get("role") == "user":
                text = stub_openai._text(m.get("content"))
                if "SCRIPT " in text:
                    m["content"] = text[text.index("SCRIPT "):]
                break
        super()._answer({**body, "messages": msgs}, raw)


@pytest.fixture(scope="module")
def stub():
    srv = StubServer().start()
    srv.RequestHandlerClass = BotHandler
    yield srv
    srv.shutdown()


@pytest.fixture(scope="module")
def world():
    (SANDBOX / "home").mkdir(parents=True, exist_ok=True)
    log = SANDBOX / "exec.jsonl"
    a = harness.Agent(harness.new_root("bot-script"))
    wrapper = a.root / "script_boot.py"
    wrapper.write_text(BOOT.format(contract=str(HERE), agent=str(AGENT_DIR), log=str(log)), encoding="utf-8")
    w, ready = harness.ready_worker(a, argv=[harness.python(), "-I", str(wrapper), "worker"],
                                    hello={"timely_tools": harness.timely_tools()},
                                    HERMES_REAL_HOME=str(SANDBOX / "home"))
    assert ready["self_test"]["ok"], ready["self_test"]
    yield a, w, log
    w.close()
    shutil.rmtree(SANDBOX, ignore_errors=True)


def ran(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


def bot_run(a, stub, check: str, steps: list, **extra) -> dict:
    prompt = (f"Buy the Pixel 10 Pro on amazon.in when it is in stock (check {check})."
              f"\nSCRIPT {json.dumps(steps)}")
    msg = {"type": "bot.run", "id": f"b-{check}", "account": a.account, "run_id": f"run-{check}",
           "bot_id": "bot_pixel", "check_id": check, "prompt": prompt, "data": {}, "skills": [],
           "tools": {"browser_sites": ["amazon.in"]}, "permission": "auto", "use_memory": False,
           "model": harness.model_cfg(stub), "deadline_s": 90, "dry_run": False, "now": "2026-11-15T09:00:00+05:30",
           "timezone": "Asia/Kolkata", "name": "Pixel buyer"}
    msg.update(extra)
    return msg


def play(w, a, run_id: str, cards: list[dict], timeout: float = 120.0):
    """Play Go: every bot.park ask is answered approve and its card kept (Go writes it on the Bot thread)."""
    seen: list[dict] = []
    while True:
        m = w.recv(timeout)
        seen.append(m)
        t = m.get("type")
        if t == "tool.call" and m.get("run") == run_id:
            w.send({"type": "tool.result", "id": m["id"], "account": a.account,
                    "result": {"ok": True, "recorded": True} if m["name"] == "bot_report" else {"ok": True}})
        elif t == "gate.ask" and m.get("run") == run_id:
            park = (m.get("bot") or {}).get("park") is True
            if park:
                cards.append({"tool": m["tool"], "args": m["args"], "args_hash": m["args_hash"]})
            w.send({"type": "gate.verdict", "id": m["id"], "account": a.account,
                    "verdict": "approve" if park else "allow", "message": CARD if park else ""})
        elif t == "bot.done" and m.get("run_id") == run_id:
            return m, seen
        elif t == "__eof__":
            raise AssertionError(f"worker exited during {run_id}: {seen}\n{w.stderr[-3000:]}")


def asks(seen):
    return [m for m in seen if m.get("type") == "gate.ask"]


def offered(stub, marker) -> set[str]:
    for r in stub.requests:
        body = r.get("body") or {}
        users = [m for m in body.get("messages") or [] if m.get("role") == "user"]
        if users and marker in stub_openai._text(users[-1].get("content")):
            return {(t.get("function") or {}).get("name") for t in body.get("tools") or []}
    return set()


def tool_texts(stub, marker) -> str:
    out = []
    for r in stub.requests:
        body = r.get("body") or {}
        users = [m for m in body.get("messages") or [] if m.get("role") == "user"]
        if users and marker in stub_openai._text(users[-1].get("content")):
            out += [stub_openai._text(m.get("content")) for m in body.get("messages") or [] if m.get("role") == "tool"]
    return "\n".join(out)


def test_a_script_parks_while_the_tick_goes_on_and_run_once_runs_it_once(world, stub):
    a, w, log = world
    cards: list[dict] = []

    # The tick: the model is offered the bot's script tool (never Hermes' own), calls it, and goes on.
    w.send(bot_run(a, stub, "sc-tick", [
        {"calls": [["bot_browser_exec", ARGS]]},
        {"calls": [["bot_report", {"title": "Pixel is in stock", "body": "Buying waits for your approval."}]]},
        {"text": "Reported."},
    ]))
    done, seen = play(w, a, "run-sc-tick", cards)
    tools = offered(stub, "sc-tick")
    assert {"bot_browser_exec", "bot_browser_dialog", "bot_browser_read"} <= tools
    assert not tools & {"browser_exec", "browser_cdp", "browser_dialog", "terminal", "browser_vault"}
    assert [x["tool"] for x in asks(seen)] == ["bot_browser_exec"] and asks(seen)[0]["bot"]["park"] is True
    assert cards == [{"tool": "bot_browser_exec", "args": ARGS, "args_hash": policy.args_hash(ARGS)}]
    assert [(p["tool"], p["args_hash"], p["message"]) for p in done["parked"]] == [
        ("bot_browser_exec", policy.args_hash(ARGS), CARD)]
    assert "Parked" in tool_texts(stub, "sc-tick")
    assert [r["title"] for r in done["reports"]] == ["Pixel is in stock"] and done["error_class"] == ""
    assert [(t["name"], t["ok"]) for t in done["trace"]][0] == ("bot_browser_exec", False)
    assert ran(log) == []  # nothing ran in the tick

    # Run once: a continuation whose pre_approved is exactly the card's call. The second identical call parks.
    card = cards[0]
    w.send(bot_run(a, stub, "sc-cont", [
        {"calls": [["bot_browser_exec", card["args"]]]},
        {"calls": [["bot_browser_exec", card["args"]]]},
        {"text": "[SILENT]"},
    ], pre_approved={"tool": card["tool"], "args_hash": card["args_hash"]}))
    cards.clear()
    done, seen = play(w, a, "run-sc-cont", cards)
    calls = ran(log)
    assert len(calls) == 1, calls
    assert calls[0] == {"code": CODE, "session": "bot-bot_pixel", "timeout_s": 120, "local": True}
    assert [x["tool"] for x in asks(seen)] == ["bot_browser_exec"] and len(cards) == 1  # only the second asked
    assert [(t["name"], t["ok"]) for t in done["trace"]] == [("bot_browser_exec", True), ("bot_browser_exec", False)]
    assert "ORDER-PLACED" in tool_texts(stub, "sc-cont") and done["error_class"] == ""
    assert "browser" in {s.get("kind") for s in done["tainted_sources"]}  # its output is outside content


def test_a_dialog_answer_parks_and_runs_nothing_in_a_tick(world, stub):
    a, w, log = world
    before = len(ran(log))
    cards: list[dict] = []
    w.send(bot_run(a, stub, "sc-dialog", [{"calls": [["bot_browser_dialog", {"action": "accept"}]]},
                                          {"text": "[SILENT]"}]))
    done, seen = play(w, a, "run-sc-dialog", cards)
    assert [(p["tool"], p["args_hash"]) for p in done["parked"]] == [
        ("bot_browser_dialog", policy.args_hash({"action": "accept"}))]
    assert len(ran(log)) == before

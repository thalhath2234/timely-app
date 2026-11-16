"""Phase 6 (Q-B2): the gate-only bot script and dialog tools, ``bot_browser_exec`` and ``bot_browser_dialog``
(``timely_bot.script``). No Hermes import: the gate runs against a fake Go and the browser is a fake.

Every call in a tick goes to Go with ``park: true`` in every mode; the tools are refused outside a
continuation even when something allowed the call; a continuation runs exactly the approved call, once.
"""

from __future__ import annotations

import json

import pytest

from timely_agent import bridge, policy
from timely_agent.plugins.timely_bot import egress, runctx, script, tools

SCRIPT_ARGS = {"code": "new_tab('https://www.amazon.in/cart')\nclick('#buy')"}
DIALOG_ARGS = {"action": "accept"}


def _bot(**over):
    base = dict(run_id="r-script", bot_id="bot_1", check_id="chk_1", permission="auto",
                read_hosts=["flipkart.com"], browser_sites=["amazon.in"], egress=[])
    base.update(over)
    return runctx.BotRun(**base)


@pytest.fixture
def tick():
    b = runctx.register(_bot())
    ctx = bridge.RunContext(run_id="r-script", session_key="k", conversation_id="bot-chk_1", kind="bot")
    yield ctx, b
    runctx.forget("r-script")


@pytest.fixture
def fake_browser():
    ran: list[tuple[str, dict]] = []
    old = script.EXEC_FN, script.DIALOG_FN
    script.EXEC_FN = lambda **kw: ran.append(("exec", kw)) or json.dumps({"success": True, "output": "bought"})
    script.DIALOG_FN = lambda **kw: ran.append(("dialog", kw)) or json.dumps({"success": True})
    yield ran
    script.EXEC_FN, script.DIALOG_FN = old


def _gate(run, tool, args, call_id="call_1", verdict="approve", message="", by=""):
    from timely_agent.plugins import timely_gate
    asked: list[dict] = []
    old = bridge.ask
    reply = {"type": "gate.verdict", "verdict": verdict, "message": message, **({"by": by} if by else {})}
    bridge.ask = lambda m, timeout: asked.append(m) or reply
    token = bridge.current_run.set(run)
    try:
        return timely_gate.pre_tool_call(tool_name=tool, args=args, tool_call_id=call_id), asked
    finally:
        bridge.current_run.reset(token)
        bridge.ask = old


def _call(run, tool, args, call_id="call_1"):
    token = bridge.current_run.set(run)
    try:
        return json.loads(tools.HANDLERS[tool](args, tool_call_id=call_id, task_id="t"))
    finally:
        bridge.current_run.reset(token)


def test_the_script_tools_are_bot_tools_with_their_own_handlers():
    for name in policy.BOT_SCRIPT_TOOLS:
        assert name in tools.SCHEMAS and tools.HANDLERS[name] is script.HANDLERS[name]
        assert name in egress.BOT_TOOLS and name in egress.PARK_ALWAYS and name not in egress.NEVER
        assert policy.taint_kind(name) == "browser"
    assert "timely_bot" in policy.BOT_TOOLSETS and "terminal" not in policy.BOT_TOOLSETS


@pytest.mark.parametrize("permission", list(policy.BOT_PERMISSIONS))
@pytest.mark.parametrize("tool,args", [("bot_browser_exec", SCRIPT_ARGS), ("bot_browser_dialog", DIALOG_ARGS)])
def test_every_call_asks_go_to_park_in_every_mode(permission, tool, args):
    for tainted in ([], [{"kind": "web"}]):
        d = egress.decide(_bot(permission=permission), tool, args, tainted=tainted)
        assert d.kind == "ask" and d.bot["park"] is True


@pytest.mark.parametrize("tool,args", [("bot_browser_exec", SCRIPT_ARGS), ("bot_browser_dialog", DIALOG_ARGS)])
def test_a_tick_parks_the_call_and_runs_nothing(tick, fake_browser, tool, args):
    ctx, b = tick
    verdict, asked = _gate(ctx, tool, args, verdict="approve", message="Run this in your browser?")
    assert verdict == {"action": "block", "message": egress.PARKED}
    assert len(asked) == 1 and asked[0]["bot"]["park"] is True and asked[0]["args_hash"] == policy.args_hash(args)
    assert [(p["tool"], p["args_hash"]) for p in b.parked] == [(tool, policy.args_hash(args))]
    assert fake_browser == []


@pytest.mark.parametrize("tool,args", [("bot_browser_exec", SCRIPT_ARGS), ("bot_browser_dialog", DIALOG_ARGS)])
def test_refused_outside_a_continuation_even_when_go_allows(tick, fake_browser, tool, args):
    ctx, _ = tick
    for by in ("auto", "full", "grant"):
        verdict, _ = _gate(ctx, tool, args, verdict="allow", by=by)
        assert verdict is None  # a Go allow passes the gate (Go never sends one for these) ...
        out = _call(ctx, tool, args)
        assert "runs only once the person approved" in out["error"]  # ... and still runs nothing
    assert fake_browser == []


def test_a_handler_called_with_no_gate_at_all_runs_nothing(tick, fake_browser):
    ctx, _ = tick
    assert "error" in _call(ctx, "bot_browser_exec", SCRIPT_ARGS)
    assert script.browser_exec(SCRIPT_ARGS) == json.dumps({"error": script.NO_RUN})  # no tick bound
    assert fake_browser == []


def test_a_continuation_runs_exactly_the_approved_call_once_on_the_real_profile(tick, fake_browser):
    ctx, b = tick
    ctx.pre_approved = {"tool": "bot_browser_exec", "args_hash": policy.args_hash(SCRIPT_ARGS)}
    # Another script first: not the approved one, so it parks and runs nothing.
    other = {"code": "click('#delete-account')"}
    verdict, asked = _gate(ctx, "bot_browser_exec", other)
    assert verdict["message"] == egress.PARKED and len(asked) == 1
    assert "error" in _call(ctx, "bot_browser_exec", other, call_id="call_1")
    # The approved call: the gate lets it through without asking Go, and the handler runs it.
    verdict, asked = _gate(ctx, "bot_browser_exec", SCRIPT_ARGS, call_id="call_2")
    assert verdict is None and asked == [] and ctx.pre_approved is None
    out = _call(ctx, "bot_browser_exec", SCRIPT_ARGS, call_id="call_2")
    assert out == {"success": True, "output": "bought"}
    assert len(fake_browser) == 1
    kind, kw = fake_browser[0]
    assert kind == "exec" and kw["code"] == SCRIPT_ARGS["code"] and kw["local"] is True
    assert kw["session"] == "bot-bot_1" and kw["task_id"] == "t"
    assert b.hosts_used == ["amazon.in"]
    # The same call again: parked, and the handler refuses it.
    verdict, asked = _gate(ctx, "bot_browser_exec", SCRIPT_ARGS, call_id="call_3")
    assert verdict["message"] == egress.PARKED and len(asked) == 1
    assert "error" in _call(ctx, "bot_browser_exec", SCRIPT_ARGS, call_id="call_3")
    assert len(fake_browser) == 1


def test_a_continuation_answers_the_approved_dialog_once(tick, fake_browser):
    ctx, _ = tick
    args = {"action": "dismiss", "prompt_text": "no"}
    ctx.pre_approved = {"tool": "bot_browser_dialog", "args_hash": policy.args_hash(args)}
    verdict, asked = _gate(ctx, "bot_browser_dialog", args)
    assert verdict is None and asked == []
    assert _call(ctx, "bot_browser_dialog", args) == {"success": True}
    assert fake_browser == [("dialog", {"action": "dismiss", "prompt_text": "no", "task_id": "t"})]
    assert "error" in _call(ctx, "bot_browser_dialog", args, call_id="call_9")


def test_a_pre_approved_script_still_needs_the_gate_to_have_let_this_call_through(tick, fake_browser):
    """A call id the gate never approved is refused, even when the script was marked."""
    ctx, b = tick
    b.allow_script("bot_browser_exec", policy.args_hash(SCRIPT_ARGS))
    assert "error" in _call(ctx, "bot_browser_exec", SCRIPT_ARGS, call_id="call_unseen")
    assert fake_browser == []


def test_a_dry_run_or_a_stopped_tick_runs_no_script(fake_browser):
    for over, stop in (({"dry_run": True}, False), ({}, True)):
        b = runctx.register(_bot(run_id="r-dry", **over))
        ctx = bridge.RunContext(run_id="r-dry", session_key="k", conversation_id="c", kind="bot")
        try:
            b.allow_script("bot_browser_exec", policy.args_hash(SCRIPT_ARGS))
            ctx.approve_call("call_1", policy.args_hash(SCRIPT_ARGS))
            if stop:
                ctx.stopped = lambda: True
            assert "error" in _call(ctx, "bot_browser_exec", SCRIPT_ARGS)
        finally:
            runctx.forget("r-dry")
    assert fake_browser == []


def test_bad_arguments_are_refused_before_anything(tick, fake_browser):
    ctx, _ = tick
    assert "empty" in _call(ctx, "bot_browser_exec", {"code": "  "})["error"]
    assert "action" in _call(ctx, "bot_browser_dialog", {"action": "click"})["error"]
    assert fake_browser == []

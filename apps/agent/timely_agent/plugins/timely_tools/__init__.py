"""timely_tools: Timely's data tools as Hermes tools (plan sections 3.4 steps 7-8, 5.2).

Go sends the chat-visible tool specs in ``hello.timely_tools`` (the Read tools, ``propose_changes``,
``resolve_target``; the same list as ``GET /agent/tool-specs``). The worker keeps them in
``bridge`` before Hermes discovers plugins, and ``register`` adds each with ``ctx.register_tool``
under toolset ``timely``. Write tools never arrive here: Go keeps their schemas in the Timely
system block, and they only reach Go inside ``propose_changes``.

Every call goes to Go as ``tool.call`` (``bridge.ask``) with the run, session key, tool call id,
arguments, the run's taint list, and the batch it came in: ``batch_size`` and ``sibling_tools``
(the other tool names of the same assistant message).

**The batch seam.** Hermes hands a tool handler only its arguments. The assistant message that
produced the calls reaches plugins through the ``post_api_request`` hook (``assistant_message``,
fired by ``agent/turn_response_intake.py`` once per model response, before any of its tools
runs); this plugin records each message's ``(tool_call_id, name)`` list on the run. The handler
finds its batch by call id, or by the latest response when Hermes renamed a reused id
(``bridge.RunContext.batch_for``). It finds its own call id in Hermes' approval observability context
(``tools.approval_context._approval_tool_call_id``, bound by ``model_tools._execute_tool`` around
every dispatch), falling back to the id ``timely_gate`` saw for that tool name.

Go's answer, ``tool.result {result, outside, end_turn}``: ``outside: true`` adds a
``{kind: "timely", tool}`` source to the run's taint and sends ``taint``; ``end_turn: true``
(after a recorded ``propose_changes``, Q-2.4) lets the model write one closing sentence, and
``timely_gate`` ends the turn on any further tool call.

**Outside text is untrusted data** (owner decision Q-3.9). An ``outside: true`` result (``ask_bot``,
``preview_bot``, ``list_bot_findings``, ``list_notifications``: they quote pages, feeds and other
people's words) reaches the model wrapped as Hermes wraps a web result
(``<untrusted_tool_result source="<tool>">``, ``timely_agent.untrusted.wrap``): the handler notes the
call, and ``transform_tool_result``, which Hermes runs after ``post_tool_call`` and before the result
enters the conversation, wraps it. Hermes passes the raw result on when a hook fails, so the hook
wraps on any doubt. As for a web result, Hermes' advisory threat scan runs on the text and a
finding goes to Go as ``event tool.output_risk``; the block is cut to fit Hermes' result limit
(``untrusted.mark``).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from timely_agent import bridge

logger = logging.getLogger("timely_agent.plugins.timely_tools")

PLUGIN = "timely_tools"
TOOLSET = "timely"
NO_RUN = "Timely tools can only run inside a Timely chat or bot run."
NO_ANSWER = "Timely did not answer this tool call in time. Tell the person and try again later."


def _error(message: str) -> str:
    return json.dumps({"error": message})


def _current_call_id() -> str:
    try:
        from tools.approval_context import _approval_tool_call_id
        return str(_approval_tool_call_id.get() or "")
    except Exception:
        return ""


def _calls_of(message: Any) -> list[tuple[str, str]]:
    """``(id, name)`` of each tool call in an assistant message (object or dict form)."""
    calls = getattr(message, "tool_calls", None)
    if calls is None and isinstance(message, dict):
        calls = message.get("tool_calls")
    out = []
    for call in calls or []:
        call_id = getattr(call, "id", None) if not isinstance(call, dict) else call.get("id")
        fn = getattr(call, "function", None) if not isinstance(call, dict) else call.get("function")
        name = getattr(fn, "name", None) if not isinstance(fn, dict) else fn.get("name")
        out.append((str(call_id or ""), str(name or "")))
    return out


def post_api_request(assistant_message: Any = None, **_: Any) -> None:
    """Record the batch of every model response on the run, before its tools run."""
    run = bridge.current_run.get()
    if run is None or assistant_message is None:
        return
    calls = _calls_of(assistant_message)
    if calls:
        run.record_batch(calls)


def make_handler(name: str):
    def handler(args: Any = None, **_: Any) -> str:
        run = bridge.current_run.get()
        if run is None or bridge.ask is None:
            return _error(NO_RUN)
        call_id = _current_call_id() or run.last_call(name)
        batch = run.batch_for(call_id, name)
        size, siblings = (batch.size, batch.siblings(call_id, name)) if batch else (1, [])
        if run.flush is not None:
            try:
                run.flush()  # stream text written before the call reaches Go first
            except Exception:
                logger.debug("flush before tool.call failed", exc_info=True)
        reply = bridge.ask({
            "type": "tool.call", "run": run.run_id, "session_key": run.session_key,
            "tool_call_id": call_id, "name": name, "args": args if isinstance(args, dict) else {},
            "tainted_sources": run.taint_snapshot(), "batch_size": size, "sibling_tools": siblings,
        }, bridge.TOOL_ANSWER_TIMEOUT_S)
        if not reply or reply.get("type") != "tool.result":
            return _error(NO_ANSWER)
        if reply.get("outside") is True:
            run.note_outside(call_id, name)
            bridge.report_taint(run, [{"kind": "timely", "tool": name}])
        if reply.get("end_turn") is True:
            run.end_turn = True
        result = reply.get("result")
        if isinstance(result, str):
            return result
        return json.dumps(result if result is not None else {}, ensure_ascii=False, default=str)
    handler.__name__ = f"timely_{name}"
    return handler


def transform_tool_result(tool_name: str = "", result: Any = None, tool_call_id: str = "", **_: Any):
    """Wrap a Timely tool result Go marked ``outside`` as untrusted data; None leaves it as it is."""
    run = bridge.current_run.get()
    if run is None or not isinstance(result, str):
        return None
    try:
        if not run.take_outside(str(tool_call_id or ""), tool_name):
            return None
    except Exception:
        logger.exception("checking whether %s quoted outside text failed", tool_name)
    from timely_agent import untrusted
    return untrusted.mark(run, tool_name, tool_call_id, result)


registered: list[str] = []  # what register() added, for the self-test


def register(ctx) -> None:
    registered.clear()
    ctx.register_hook("post_api_request", post_api_request)
    ctx.register_hook("transform_tool_result", transform_tool_result)
    for spec in bridge.timely_tools():
        name = spec["name"]
        schema = {"name": name, "description": spec.get("description") or "",
                  "parameters": spec.get("parameters") or {"type": "object", "properties": {}}}
        handle = ctx.register_tool(name=name, toolset=TOOLSET, schema=schema, handler=make_handler(name),
                                   description=schema["description"])
        if handle is None:
            logger.error("Timely tool %s was not registered (its name is taken)", name)
            continue
        registered.append(name)

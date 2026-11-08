"""timely_gate: Timely's tool policy at Hermes' ``pre_tool_call`` hook (plan sections 3.5, 8.1).

Hermes runs this hook for every tool call, MCP included, before the tool runs. Phase-1 policy:

1. Messaging and never-offered tools: ``block``.
2. A call Go pre-approved for a parked-approval continuation (same tool, same args hash): allow.
3. A few read-only bookkeeping tools (``policy.LOCAL_ALLOW``) and the Timely toolset: allow.
4. Everything else: ask Go (``gate.ask``) and return its verdict; no answer means ``block``.

An ``approve`` verdict becomes Hermes' human-approval gate with ``rule_key
timely:<tool_call_id>`` (the approval payload carries no arguments, so the key carries the id).
"""

from __future__ import annotations

import logging
from typing import Any

from timely_agent import bridge, policy

logger = logging.getLogger("timely_agent.plugins.timely_gate")

PLUGIN = "timely_gate"
TIMELY_TOOLSET_PREFIX = "timely_"
NO_RUN = "Blocked: this tool can only run inside a Timely chat or bot run."
NO_ANSWER = "Blocked: Timely did not answer the permission check in time."


def _timely_tool(tool_name: str) -> bool:
    try:
        from tools.registry import registry
        entry = registry.get_entry(tool_name)
        return getattr(entry, "toolset", "") == "timely"
    except Exception:
        return False


def pre_tool_call(tool_name: str = "", args: dict | None = None, tool_call_id: str = "",
                  session_id: str = "", task_id: str = "", **_: Any) -> dict | None:
    args = args if isinstance(args, dict) else {}
    if policy.is_blocked(tool_name):
        return {"action": "block", "message": f"Blocked: {tool_name} is not available in Timely."}
    run = bridge.current_run.get()
    pre = run.pre_approved if run else None
    if pre and pre.get("tool") == tool_name and pre.get("args_hash") == policy.args_hash(args):
        run.pre_approved = None  # exactly one matching call
        return None
    if tool_name in policy.LOCAL_ALLOW or _timely_tool(tool_name):
        return None
    if run is None or bridge.ask is None:
        return {"action": "block", "message": NO_RUN}
    reply = bridge.ask({
        "type": "gate.ask", "run": run.run_id, "tool_call_id": tool_call_id, "tool": tool_name,
        "args": args, "tainted_sources": list(run.tainted_sources), "run_kind": run.kind,
    }, bridge.HOOK_ANSWER_TIMEOUT_S)
    if not reply or reply.get("type") != "gate.verdict":
        return {"action": "block", "message": NO_ANSWER}
    verdict = reply.get("verdict")
    message = str(reply.get("message") or "")
    if verdict == "allow":
        return None
    if verdict == "approve":
        return {"action": "approve", "message": message or f"Run {tool_name}?",
                "rule_key": f"timely:{tool_call_id or tool_name}"}
    return {"action": "block", "message": message or f"Blocked: Timely did not allow {tool_name}."}


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)

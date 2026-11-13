"""timely_gate: Timely's tool policy at Hermes' ``pre_tool_call`` hook (plan sections 3.4, 3.5, 8.1).

Hermes runs this hook for every tool call, MCP included, before the tool runs. Policy:

0. The turn has ended (Q-2.4): Go answered a recorded ``propose_changes`` with ``end_turn``; the
   model may write one closing sentence, and any further tool call is blocked and ends the turn
   (a soft interrupt with ``tool_reason="timely_end_turn"``; ``run_chat`` reports it as
   ``turn_exit_reason: "end_turn"``, not as a Stop).

1. Messaging and never-offered tools: ``block``.
1b. A browser tool (``browser_*``) whose arguments name a URL on a private, loopback, link-local
   or CGNAT/Tailscale address, by literal or by what the name resolves to: ``block``. Hermes' URL
   policy skips that floor for a local browser (``tools/browser_url_policy.py``: the local and
   sidecar Chromium ignore ``security.allow_private_urls``), so the gate applies Hermes' own
   ``url_safety.is_safe_url`` to every URL literal in the arguments (plan 12; what a literal
   check cannot see, such as URLs built at run time or redirects, is the residual in plan 14).
1c. ``web_search`` and ``web_extract`` after the session read outside content: no rule of
   Timely's own (owner decision Q-3.9); they go to Go's ``gate.ask`` like any other call. Hermes'
   own handling applies on every backend: results wrapped as untrusted data and threat-scanned
   (the scan reaches Go as ``event tool.output_risk``), a URL carrying a key or token refused, and
   the SSRF floor. Taint still holds the chat's next proposal for review and stages learning.
2. A call Go pre-approved for a parked-approval continuation (same tool, same args hash): allow.
2b. ``propose_changes`` that is not the only call of its assistant message: ``block`` with
   "Call propose_changes alone, after all read tools finish" (plan 3.4 step 8). The batch was
   recorded from the model response (``timely_tools.post_api_request``) before any of its tools
   ran, so the decision never depends on whether a sibling ran first; an unknown batch blocks too.
3. A few read-only bookkeeping tools (``policy.LOCAL_ALLOW``) and the Timely toolset: allow.
4. Everything else: ask Go (``gate.ask``) and return its verdict; no answer means ``block``. In
   phase 2 Go answers ``block`` ("That isn't available in Timely yet") for every such tool.

Phase 4 (``timely_agent.delegation``):

5. ``clarify`` runs locally in a chat run (the question card, Q-4.3) and is blocked in a bot,
   ``from_bot`` or no-persist run (the recursion guard: bots never ask).
6. ``delegate_task`` runs locally in such a chat run within the caps: at most 3 children per run in
   total, none in the background. Blocked in bot, ``from_bot`` and no-persist runs.
7. A call made inside a sub-task: ``propose_changes``, ``session_search``, ``skill_manage``,
   ``memory``, ``clarify`` and ``delegate_task`` are blocked, and every other call counts against
   the run's shared pool of child tool calls (blocked once it is used up). Then rules 2b-4 apply
   as for the run itself.

``post_tool_call`` reports ``{kind: "web", tool: "web_extract", host}`` as taint for each host a
``web_extract`` that ran named (any backend), so the chat's taint names the sites it read; in a
sub-task the source also says ``via: "subagent"`` and names the child. After a ``delegate_task``
it records the children's live transcript folders under the chat, so deleting the chat removes them.
``transform_tool_result`` marks a ``delegate_task`` result as untrusted data when a child of that call
read outside content (the child's summary may quote the page; Q-3.9) and drops the host's transcript
paths from what the model reads (``delegation.transform_result``).
``subagent_start`` / ``subagent_stop`` map each child to the run and send ``event subagent``.

An ``approve`` verdict becomes Hermes' human-approval gate with ``rule_key
timely:<tool_call_id>`` (the approval payload carries no arguments, so the key carries the id).
"""

from __future__ import annotations

import logging
from typing import Any

from timely_agent import bridge, delegation, policy

logger = logging.getLogger("timely_agent.plugins.timely_gate")

PLUGIN = "timely_gate"
TIMELY_TOOLSET_PREFIX = "timely_"
NO_RUN = "Blocked: this tool can only run inside a Timely chat or bot run."
NO_ANSWER = "Blocked: Timely did not answer the permission check in time."
END_TURN = ("Blocked: the proposal is recorded and this turn has ended. Reply to the person in one "
            "sentence; do not call more tools.")
UNKNOWN_BATCH = "Blocked: Timely could not tell which calls came with propose_changes. " + policy.PROPOSE_ALONE + "."
PRIVATE_TARGET = ("Blocked: {tool} would reach {url}, a private, loopback or internal address. "
                  "Timely's browser only visits public sites.")
BROWSER_PREFIX = "browser_"


def _url_literals(value: Any, key: str = "") -> list[str]:
    """Every URL a tool's arguments name: each ``url`` value whole, plus the ``http(s)://`` and
    scheme-relative ``//host`` literals in every string at any depth (Hermes' own extractor)."""
    from tools.browser_url_policy import url_literals
    if isinstance(value, str):
        whole = [value.strip()] if key == "url" and value.strip() else []
        return whole + url_literals(value, protocol_relative=True)
    if isinstance(value, dict):
        return [u for k, v in value.items() for u in _url_literals(v, str(k))]
    if isinstance(value, (list, tuple)):
        return [u for v in value for u in _url_literals(v, key)]
    return []


def private_browser_target(tool_name: str, args: dict) -> str | None:
    """The first URL in a browser tool's arguments that Hermes' SSRF check refuses, else None."""
    if not tool_name.startswith(BROWSER_PREFIX):
        return None
    from tools.url_safety import is_safe_url
    for literal in dict.fromkeys(_url_literals(args)):
        lowered = literal.lower()
        if lowered.startswith(("about:", "data:", "chrome:", "devtools:")):
            continue  # no network target (Hermes' own CDP guard judges these schemes)
        url = "http:" + literal if literal.startswith("//") else literal
        if "://" not in url:
            url = "http://" + url  # a bare host[:port] in a `url` argument
        if not is_safe_url(url):
            return literal
    return None


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
    try:
        target = private_browser_target(tool_name, args)
    except Exception as exc:  # fail closed: a broken check must not let the call through
        logger.warning("private-target check failed for %s: %s", tool_name, exc)
        target = f"an address Timely could not check ({type(exc).__name__})"
    if target:
        return {"action": "block", "message": PRIVATE_TARGET.format(tool=tool_name, url=target[:200])}
    run = bridge.current_run.get()
    if run is not None and run.end_turn:
        return _end_turn(run)
    child = bridge.current_child(run, session_id)
    if child:
        verdict = delegation.child_verdict(run, child, tool_name)
        if verdict is not None:
            return verdict
    if run is not None and tool_call_id:
        run.note_call(tool_name, tool_call_id, child)
    if tool_name == policy.CLARIFY_TOOL:
        return delegation.clarify_verdict(run)
    if tool_name == policy.DELEGATE_TOOL:
        return delegation.verdict(run, args, tool_call_id)
    if tool_name == policy.PROPOSE_TOOL and _timely_tool(tool_name):
        batch = run.batch_for(tool_call_id, tool_name, child) if run is not None else None
        if batch is None:
            logger.warning("propose_changes %r: no recorded batch for this call id", tool_call_id)
            return {"action": "block", "message": UNKNOWN_BATCH}
        if batch.size != 1:
            return {"action": "block", "message": policy.PROPOSE_ALONE}
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


def _end_turn(run) -> dict:
    """Block the call and stop the loop after this round (soft interrupt, system reason)."""
    run.end_turn_hit = True
    agent = run.agent
    if agent is not None:
        try:
            agent.interrupt(None, tool_reason="timely_end_turn")
        except Exception as exc:
            logger.warning("ending the turn after propose_changes failed: %s", exc)
    return {"action": "block", "message": END_TURN}


def post_tool_call(tool_name: str = "", args: dict | None = None, status: str | None = None,
                   session_id: str = "", **kw: Any) -> None:
    """Report each host a ``web_extract`` that ran named as taint (the page's site); after a
    ``delegate_task``, remember its children's transcript folders under the chat."""
    if tool_name == policy.DELEGATE_TOOL:  # any status: the call's hold on the children cap ends
        delegation.settle(bridge.current_run.get(), str(kw.get("tool_call_id") or ""))
    if status == "blocked" or tool_name not in ("web_extract", policy.DELEGATE_TOOL):
        return
    run = bridge.current_run.get()
    if run is None:
        return
    if tool_name == policy.DELEGATE_TOOL:
        try:
            delegation.record_live(run.conversation_id, kw.get("result"))
        except Exception as exc:
            logger.warning("recording the sub-task transcripts failed: %s", exc)
        return
    try:
        hosts = policy.extract_hosts(args if isinstance(args, dict) else {})
        if hosts:
            bridge.report_taint(run, [{"kind": "web", "tool": "web_extract", "host": h} for h in hosts],
                                session_id)
    except Exception as exc:
        logger.warning("reporting web_extract hosts as taint failed: %s", exc)


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("transform_tool_result", delegation.transform_result)
    ctx.register_hook("subagent_start", delegation.subagent_start)
    ctx.register_hook("subagent_stop", delegation.subagent_stop)

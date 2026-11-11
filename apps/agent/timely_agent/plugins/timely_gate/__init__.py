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
1c. The exfiltration rule (phase 3, ``egress``; plan 8.1 web row, 12): in a tainted session,
   ``web_extract`` and ``browser_*`` URLs to a host the person did not type and no search in this
   conversation returned, a ``web_extract`` URL carrying Timely or memory text, and a
   ``web_search`` query carrying text from a Timely read, memory or a tainted result: ``block``
   with "Paste the link yourself if you want me to open it", before Go is asked. No approval path
   until phase 5. A clean session is not restricted beyond the SSRF floor.
2. A call Go pre-approved for a parked-approval continuation (same tool, same args hash): allow.
2b. ``propose_changes`` that is not the only call of its assistant message: ``block`` with
   "Call propose_changes alone, after all read tools finish" (plan 3.4 step 8). The batch was
   recorded from the model response (``timely_tools.post_api_request``) before any of its tools
   ran, so the decision never depends on whether a sibling ran first; an unknown batch blocks too.
3. A few read-only bookkeeping tools (``policy.LOCAL_ALLOW``) and the Timely toolset: allow.
4. Everything else: ask Go (``gate.ask``) and return its verdict; no answer means ``block``. In
   phase 2 Go answers ``block`` ("That isn't available in Timely yet") for every such tool.

``post_tool_call`` feeds the rule: the hosts and URLs a ``web_search`` returned, Timely read results
and tainted results, kept per conversation (``egress.Record``; earlier turns come from the session's
``state.db`` transcript), and it reports ``{kind: "web", tool: "web_extract", host}`` for each host a
``web_extract`` that ran named.

An ``approve`` verdict becomes Hermes' human-approval gate with ``rule_key
timely:<tool_call_id>`` (the approval payload carries no arguments, so the key carries the id).
"""

from __future__ import annotations

import logging
from typing import Any

from timely_agent import bridge, policy
from timely_agent.plugins.timely_gate import egress

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
    if run is not None and tool_call_id:
        run.note_call(tool_name, tool_call_id)
    if tool_name == policy.PROPOSE_TOOL and _timely_tool(tool_name):
        batch = run.batch_for(tool_call_id, tool_name) if run is not None else None
        if batch is None:
            logger.warning("propose_changes %r: no recorded batch for this call id", tool_call_id)
            return {"action": "block", "message": UNKNOWN_BATCH}
        if batch.size != 1:
            return {"action": "block", "message": policy.PROPOSE_ALONE}
    if run is not None and (tool_name in egress.WEB_TOOLS or tool_name.startswith(BROWSER_PREFIX)):
        blocked = _egress(run, tool_name, args)
        if blocked:
            return {"action": "block", "message": blocked}
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


# ---------------------------------------------------------------- exfiltration rule (egress)

def _memory_docs() -> list[str]:
    """MEMORY.md and USER.md: each entry, and each file whole."""
    from timely_agent.learning import files
    home = files.home_dir()
    docs: list[str] = []
    for target in ("memory", "user"):
        entries = files.read_memory(home, target)
        docs += entries + (["\n".join(entries)] if len(entries) > 1 else [])
    return docs


def _record(run) -> egress.Record:
    rec = egress.record(run.conversation_id or run.session_key)
    rec.begin(run.run_id)
    return rec


def _load_stored(run, rec: egress.Record) -> None:
    """The conversation's earlier turns from ``state.db``, once per run (fail closed: an unreadable
    transcript adds nothing, so fewer hosts are allowed)."""
    with rec.lock:
        if rec.stored is not None:
            return
    part = egress.Part()
    try:
        db = getattr(run.agent, "_session_db", None)
        if db is None:
            from hermes_state import SessionDB
            db = SessionDB()
        messages = db.get_messages_as_conversation(run.conversation_id) if run.conversation_id else []
        egress.load_transcript(part, messages or [], is_timely=_timely_tool, taint_kind=_taint_kind)
    except Exception as exc:
        logger.warning("reading the transcript for the exfiltration rule failed: %s", exc)
    with rec.lock:
        if rec.stored is None:
            rec.stored = part


def _taint_kind(tool_name: str) -> str:
    try:
        from tools.registry import registry
        toolset = str(getattr(registry.get_entry(tool_name), "toolset", "") or "")
    except Exception:
        toolset = ""
    return policy.taint_kind(tool_name, toolset)


def _egress(run, tool_name: str, args: dict) -> str | None:
    try:
        tainted = bool(run.taint_snapshot())
        if not tainted:
            return None
        rec = _record(run)
        _load_stored(run, rec)
        return egress.check(tool_name, args, tainted=True, person_hosts=run.person_hosts, rec=rec,
                            memory=_memory_docs(), browser_urls=lambda a: list(dict.fromkeys(_url_literals(a))))
    except Exception as exc:  # fail closed
        logger.warning("exfiltration check failed for %s: %s", tool_name, exc)
        return egress.CHECK_FAILED.format(tool=tool_name, error=type(exc).__name__)


def post_tool_call(tool_name: str = "", args: dict | None = None, result: Any = None, status: str | None = None,
                   **_: Any) -> None:
    """Feed the exfiltration rule from a call that ran, and report a web_extract's hosts as taint."""
    if status == "blocked":
        return
    run = bridge.current_run.get()
    if run is None:
        return
    args = args if isinstance(args, dict) else {}
    try:
        timely = _timely_tool(tool_name)
        kind = "" if timely else _taint_kind(tool_name)
        if tool_name == "web_extract":
            hosts = list(dict.fromkeys(h for h in map(egress.url_host, egress.extract_urls(args)) if h))
            if hosts:
                bridge.report_taint(run, [{"kind": "web", "tool": "web_extract", "host": h} for h in hosts])
        if not (timely or kind or tool_name == "web_search"):
            return
        rec = _record(run)
        with rec.lock:
            egress.classify(rec.live, tool_name, result, is_timely=lambda _n: timely, taint_kind=lambda _n: kind)
    except Exception as exc:
        logger.warning("recording %s for the exfiltration rule failed: %s", tool_name, exc)


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)

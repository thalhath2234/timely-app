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

Phase 5 (host tools, PROTOCOL.md section 12; ``timely_agent.host``):

0b. A stopped run blocks every call (no host tool after Stop); the dispatch fence (R6) also
    refuses a host tool whose Run once raced the Stop.
8. A host call (``policy.is_host_call``: terminal, process, files, ``execute_code``, ``browser_exec``,
   ``browser_cdp``, ``browser_dialog``, ``vision_analyze`` on a local path) or an MCP tool: blocked in
   a bot run, and a host call is blocked when the run lacks ``flags.host_allowed`` (second lines
   behind Go). ``read_file``/``search_files`` inside the account's own skills folder run without a
   card (plan 5.5, the learning pass reads skills). Rule 2 (pre-approved continuation call) applies;
   otherwise the call always asks Go, never ``LOCAL_ALLOW``. ``gate.ask`` carries ``args_hash``,
   ``toolset``, ``inner: true`` for a call made inside ``execute_code`` (Hermes gives it no call id;
   the gate names it ``<execute_code id>:inner:<n>``) and ``mcp {server, tool, annotations}``.
   What a ``process``/``process_manage`` ``write`` or ``submit`` types into a running command is
   checked against Hermes' hardline floor first, in every mode (Hermes guards no stdin).
   An ``allow`` records the call as Timely-approved (``by: "auto"``: by Auto's mode alone, so
   Hermes' own second prompt for it becomes a card instead of an automatic yes); an ``approve``
   records what the card is for and, in Full Access, turns the run's YOLO off first so the card
   reaches the person.

``post_tool_call`` sends ``event host.ran`` for every host or MCP call that finished, with the
checkpoint Hermes took before it (``checkpoint``, ``checkpoint_dir``).
"""

from __future__ import annotations

import logging
from typing import Any

from timely_agent import bridge, delegation, host, policy

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


def _toolset(tool_name: str) -> str:
    try:
        from tools.registry import registry
        return str(getattr(registry.get_entry(tool_name), "toolset", "") or "")
    except Exception:
        return ""


def _in_skills_folder(args: dict) -> bool:
    """Every path a read names resolves inside ``HERMES_HOME/skills`` (symlinks followed)."""
    import os
    from pathlib import Path
    home = os.environ.get("HERMES_HOME", "")
    raw = args.get("path")
    if not home or not isinstance(raw, str) or not raw.strip():
        return False
    try:
        root = (Path(home) / "skills").resolve()
        # A relative path means what the file tool means by it: the terminal's folder (the person's
        # working folder), never the skills folder. Hermes' own resolver does the anchoring.
        try:
            from tools.file_tools_paths import _resolve_path_for_task
            target = Path(str(_resolve_path_for_task(raw, "default"))).resolve()
        except ImportError:  # unit tests without Hermes on the path: the same anchoring by hand
            target = Path(raw).expanduser()
            if not target.is_absolute():
                target = Path(os.environ.get("TERMINAL_CWD") or os.getcwd()) / target
            target = target.resolve()
        return target == root or root in target.parents
    except Exception as exc:
        logger.debug("skills folder check for %r: %s", raw, exc)
        return False


def mcp_info(tool_name: str, toolset: str) -> dict[str, Any]:
    """``{server, tool, annotations}`` for an MCP tool: the server that registered it, the tool's own
    name and the hints it declared (empty when unknown; Go then treats it as a write)."""
    server = toolset[len(policy.MCP_TOOLSET_PREFIX):] if toolset.startswith(policy.MCP_TOOLSET_PREFIX) else ""
    original, annotations = tool_name, {}
    try:
        from tools import mcp_tool as core
        server = core._mcp_tool_server_names.get(tool_name, server) or server
        from tools.mcp_tool_common import mcp_field
        from tools.mcp_tool_schema import sanitize_mcp_name_component
        prefix = f"{policy.MCP_TOOL_PREFIX}{sanitize_mcp_name_component(server)}__"
        short = tool_name[len(prefix):] if tool_name.startswith(prefix) else tool_name
        for task in list(core._servers.values()):
            if getattr(task, "name", None) != server:
                continue
            for t in getattr(task, "_tools", None) or []:
                if sanitize_mcp_name_component(getattr(t, "name", "")) == short:
                    original = str(t.name)
                    ann = getattr(t, "annotations", None)
                    for snake, camel in (("read_only_hint", "readOnlyHint"), ("destructive_hint", "destructiveHint"),
                                         ("idempotent_hint", "idempotentHint"), ("open_world_hint", "openWorldHint")):
                        value = mcp_field(ann, snake, camel) if ann is not None else None
                        if isinstance(value, bool):
                            annotations[camel] = value
                    break
            break
        else:
            original = short
    except Exception as exc:
        logger.debug("MCP tool info for %s: %s", tool_name, exc)
    return {"server": server, "tool": original, "annotations": annotations}


def pre_tool_call(tool_name: str = "", args: dict | None = None, tool_call_id: str = "",
                  session_id: str = "", task_id: str = "", **_: Any) -> dict | None:
    args = args if isinstance(args, dict) else {}
    if policy.is_blocked(tool_name):
        return {"action": "block", "message": f"Blocked: {tool_name} is not available in Timely."}
    run = bridge.current_run.get()
    if run is not None and run.stopping:
        return {"action": "block", "message": policy.STOPPED}
    try:
        target = private_browser_target(tool_name, args)
    except Exception as exc:  # fail closed: a broken check must not let the call through
        logger.warning("private-target check failed for %s: %s", tool_name, exc)
        target = f"an address Timely could not check ({type(exc).__name__})"
    if target:
        return {"action": "block", "message": PRIVATE_TARGET.format(tool=tool_name, url=target[:200])}
    if run is not None and run.end_turn:
        return _end_turn(run)
    child = bridge.current_child(run, session_id)
    if child:
        verdict = delegation.child_verdict(run, child, tool_name)
        if verdict is not None:
            return verdict
    inner = False
    if run is not None and not tool_call_id:
        outer = host.context_call_id()
        if outer and run.call_tool(outer) == "execute_code":
            inner, tool_call_id = True, run.inner_call_id(outer)
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
    toolset = _toolset(tool_name)
    is_host = policy.is_host_call(tool_name, args)
    is_mcp = policy.is_mcp_tool(tool_name, toolset)
    digest = policy.args_hash(args)
    if is_host or is_mcp:
        if run is None:
            return {"action": "block", "message": NO_RUN}
        if run.kind != "chat":
            return {"action": "block", "message": policy.BOT_HOST}
        if is_host and not run.host_allowed:
            return {"action": "block", "message": policy.NOT_HOST_ALLOWED}
        if tool_name in policy.SKILLS_READ_TOOLS and _in_skills_folder(args):
            return None
        if is_host:
            try:
                refusal = host.stdin_floor(tool_name, args)
            except Exception as exc:  # fail closed: a broken check must not let typed input through
                logger.warning("stdin floor check failed for %s: %s", tool_name, exc)
                refusal = f"Blocked: Timely could not check what {tool_name} would type ({type(exc).__name__})."
            if refusal:
                return {"action": "block", "message": refusal}
    pre = run.pre_approved if run else None
    if pre and pre.get("tool") == tool_name and pre.get("args_hash") == digest:
        run.pre_approved = None  # exactly one matching call
        if tool_call_id:
            run.approve_call(tool_call_id, digest)
            host.mark_executing(run, tool_call_id)
        return None
    if not (is_host or is_mcp) and (tool_name in policy.LOCAL_ALLOW or _timely_tool(tool_name)):
        return None
    if run is None or bridge.ask is None:
        return {"action": "block", "message": NO_RUN}
    ask: dict[str, Any] = {
        "type": "gate.ask", "run": run.run_id, "tool_call_id": tool_call_id, "tool": tool_name,
        "args": args, "tainted_sources": list(run.tainted_sources), "run_kind": run.kind,
        "args_hash": digest, "toolset": toolset,
    }
    if inner:
        ask["inner"] = True
    if is_mcp:
        ask["mcp"] = mcp_info(tool_name, toolset)
    reply = bridge.ask(ask, bridge.HOOK_ANSWER_TIMEOUT_S)
    if not reply or reply.get("type") != "gate.verdict":
        return {"action": "block", "message": NO_ANSWER}
    verdict = reply.get("verdict")
    message = str(reply.get("message") or "")
    if run.stopping:  # Stop landed while Go answered
        return {"action": "block", "message": policy.STOPPED}
    if verdict == "allow":
        if tool_call_id:
            # ``by: "auto"``: Go let it through by Auto's mode alone, so no person stands behind it
            # (Hermes' own dangerous-command prompt for it becomes a card, not an automatic yes).
            run.approve_call(tool_call_id, digest, backed=reply.get("by") != "auto")
            host.mark_executing(run, tool_call_id)
        return None
    if verdict == "approve":
        call_key = tool_call_id or tool_name
        run.note_asked(call_key, {"tool": tool_name, "args_hash": digest, "toolset": toolset})
        host.suspend_yolo(run)
        host.mark_executing(run, call_key)
        return {"action": "approve", "message": message or f"Run {tool_name}?",
                "rule_key": f"timely:{call_key}"}
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
    ``delegate_task``, remember its children's transcript folders under the chat; after a host or
    MCP call, send ``host.ran``."""
    a = args if isinstance(args, dict) else {}
    if policy.is_host_call(tool_name, a) or policy.is_mcp_tool(tool_name):
        run = bridge.current_run.get()
        if run is not None:
            call_id = (str(kw.get("tool_call_id") or "") or host.executing_call(run)
                       or host.context_call_id())
            try:
                host.report_ran(run, tool_name, a, call_id, status)
            except Exception as exc:
                logger.warning("reporting host.ran for %s failed: %s", tool_name, exc)
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

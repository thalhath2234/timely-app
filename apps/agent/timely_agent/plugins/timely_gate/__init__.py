"""timely_gate: Timely's tool policy at Hermes' ``pre_tool_call`` hook (plan sections 3.5, 8.1).

Hermes runs this hook for every tool call, MCP included, before the tool runs. Phase-1 policy:

1. Messaging and never-offered tools: ``block``.
1b. A browser tool (``browser_*``) whose arguments name a URL on a private, loopback, link-local
   or CGNAT/Tailscale address, by literal or by what the name resolves to: ``block``. Hermes' URL
   policy skips that floor for a local browser (``tools/browser_url_policy.py``: the local and
   sidecar Chromium ignore ``security.allow_private_urls``), so the gate applies Hermes' own
   ``url_safety.is_safe_url`` to every URL literal in the arguments (plan 12; what a literal
   check cannot see, such as URLs built at run time or redirects, is the residual in plan 14).
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

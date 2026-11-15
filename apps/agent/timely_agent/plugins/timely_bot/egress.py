"""The bot egress policy (plan 7.5): what ``timely_gate`` decides for a call in a Bot tick before
Go is asked. Stdlib only.

Nobody can approve anything during a tick and every tick reads untrusted pages, so the floor does
not depend on prompt text, only on the run's tool policy and taint:

(a) outbound URL tools (``web_extract``, ``bot_browser_read``, any MCP tool with a URL argument)
    go only to **bot hosts** (``runctx.BotRun.bot_hosts``);
(b) no ``session_search`` and no terminal, file, code, ``clarify``, ``delegate_task``,
    ``cronjob_manage``, ``create_bot`` or messaging tool, ever;
(c) after taint, an MCP tool must carry ``readOnlyHint``;
(d) after taint, ``web_search`` is blocked (a query string is an outbound channel).

Full Access (``permission: full``, sent by Go only after the step-up) lifts (a), (c) and (d); it
never lifts (b). Everything that passes the floor is then asked of Go (``gate.ask`` with a ``bot``
context), which answers allow, approve (the step parks in Needs you) or block.

``decide`` returns a :class:`Decision`: ``block`` (nothing runs, the message goes to the model),
``allow`` (a Timely tool of the bot's own, no Go round trip) or ``ask`` (``bot`` is the context
sent with the ``gate.ask``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

from timely_agent import policy
from timely_agent.plugins.timely_bot import runctx

BROWSER_READ = "bot_browser_read"
BOT_TOOLS = ("bot_note_get", "bot_note_set", "bot_note_delete", "bot_report", BROWSER_READ)
# Offered to a Bot only through the gate, and every call parks (Q-B2): a script, a dialog.
PARK_ALWAYS = ("browser_exec", "browser_cdp", "browser_dialog")
# Never reach a Bot tick (plan 7.5 "Never" rows; terminal, file and code are host tools).
NEVER = frozenset({
    "terminal", "process", "process_manage", "read_file", "search_files", "write_file", "patch",
    "execute_code", "clarify", "delegate_task", "session_search", "cronjob_manage", "create_bot",
    "update_bot", "propose_changes", "browser_vault", "send_message",
})
READ_ONLY_TIMELY_LOCAL = frozenset({"skills_list", "skill_view"})

NOT_FOR_BOTS = "Blocked: {tool} is not available in a bot run."
PROPOSE = "Blocked: a bot run does not call propose_changes. Put the change in bot_report's proposal."
OFF_HOST = ("Blocked: {host} is not one of this bot's sites (its Reads, its browser sites or its extra hosts), "
            "so {tool} will not go there. Say so in bot_report if you need it.")
SEARCH_AFTER_TAINT = ("Blocked: web_search is off once this run has read outside content (a query can carry "
                      "what you read out of Timely). Use bot_report to say what you need.")
MCP_NOT_ALLOWED = "Blocked: the MCP tool {tool} is not one the person allowed for this bot."
MCP_AFTER_TAINT = ("Blocked: this run has read outside content, so only read-only MCP tools may run now; "
                   "{tool} is not marked read-only.")
MCP_URL = "Blocked: {tool} was given {url}, which is not one of this bot's sites."
PARKED = ("Parked: this step needs the person's approval. It waits in Needs you and the run goes on "
          "without it. Do not try it again; say in bot_report that it is waiting.")
BROWSER_BUSY = "browser busy"


@dataclass
class Decision:
    kind: str  # "block" | "allow" | "ask"
    message: str = ""
    bot: dict[str, Any] = field(default_factory=dict)


def _block(message: str) -> Decision:
    return Decision("block", message)


def tainted_flag(tainted: Any) -> bool:
    return bool(tainted)


def decide(bot: runctx.BotRun, tool: str, args: Mapping[str, Any] | None, *, tainted: Any,
           toolset: str = "", mcp: Optional[Mapping[str, Any]] = None, is_mcp: bool = False,
           is_timely: bool = False) -> Decision:
    """The floor for one call of a bot tick (see the module docstring)."""
    args = args if isinstance(args, Mapping) else {}
    is_tainted = tainted_flag(tainted)
    ctx: dict[str, Any] = {"bot_id": bot.bot_id, "check_id": bot.check_id, "tainted": is_tainted,
                           "permission": bot.permission, "dry_run": bot.dry_run}
    if tool == "propose_changes":
        return _block(PROPOSE)
    if tool in NEVER:
        return _block(policy.BOT_HOST if tool in policy.HOST_TOOLS else NOT_FOR_BOTS.format(tool=tool))
    if tool in ("bot_note_get", "bot_note_set", "bot_note_delete", "bot_report") or tool in READ_ONLY_TIMELY_LOCAL:
        return Decision("allow", bot=ctx)
    if tool == "web_search":
        if is_tainted and not bot.full:
            return _block(SEARCH_AFTER_TAINT)
        return Decision("ask", bot=ctx)
    if tool == "web_extract":
        hosts = []
        raw = args.get("urls")
        for item in [raw] if isinstance(raw, str) else (raw if isinstance(raw, (list, tuple)) else []):
            hosts.append(runctx.norm_host(item.get("url") or item.get("href") if isinstance(item, dict) else item))
        if not bot.full:
            for host in hosts:
                if not bot.is_bot_host(host):
                    return _block(OFF_HOST.format(host=host or "that address", tool=tool))
        ctx["hosts"] = [h for h in hosts if h]
        return Decision("ask", bot=ctx)
    if tool == BROWSER_READ:
        host = runctx.norm_host(args.get("url"))
        if not host:
            return _block("Blocked: bot_browser_read needs an http(s) url.")
        if not bot.full and not bot.is_bot_host(host):
            return _block(OFF_HOST.format(host=host, tool=tool))
        ctx.update(host=host, granted=bot.is_granted(host))
        return Decision("ask", bot=ctx)
    if tool in PARK_ALWAYS:
        ctx["park"] = True
        return Decision("ask", bot=ctx)
    if is_mcp:
        info = dict(mcp or {})
        server, name = str(info.get("server") or ""), str(info.get("tool") or tool)
        if not bot.mcp_allowed(server, name):
            return _block(MCP_NOT_ALLOWED.format(tool=tool))
        if not bot.full:
            for url in runctx.urls_in(args):
                if not bot.is_bot_host(runctx.norm_host(url)):
                    return _block(MCP_URL.format(tool=tool, url=url[:200]))
            ann = info.get("annotations") if isinstance(info.get("annotations"), Mapping) else {}
            if is_tainted and ann.get("readOnlyHint") is not True:
                return _block(MCP_AFTER_TAINT.format(tool=tool))
        return Decision("ask", bot=ctx)
    if is_timely:  # Timely read tools: Go answers inside tool.call (a read subset for bots)
        return Decision("allow", bot=ctx)
    return Decision("ask", bot=ctx)

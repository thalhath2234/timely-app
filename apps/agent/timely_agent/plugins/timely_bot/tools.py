"""The Bot tick's own tools: ``bot_note_get``, ``bot_note_set``, ``bot_note_delete``, ``bot_report`` and
``bot_browser_read`` (plan 7.5, Q-B2). Registered by ``timely_bot.register`` under toolset ``timely_bot``.

The note and report tools are ``tool.call`` requests to Go, scoped to this bot and check (the message
carries ``bot {bot_id, check_id, dry_run}``). In a dry run ("Try it now") nothing is written: note writes
stay in the run's overlay (a later ``bot_note_get`` of the same tick sees them) and a report is only kept
for ``bot.done``. A report Go accepts is also listed in ``bot.done.reports``.

``bot_browser_read(url)`` opens one page and returns its text (or accessibility snapshot) through
Hermes' browser session code on the real signed-in profile (``timely_bot.browser``). It takes no
script, no selector, no click and no input, so "no form submit" holds by construction. ``timely_gate``
decides first (bot hosts, granted sites, ``browser busy``).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Optional

from timely_agent import bridge, policy
from timely_agent.plugins.timely_bot import runctx

logger = logging.getLogger("timely_agent.plugins.timely_bot")

TOOLSET = "timely_bot"
MAX_KEY_CHARS = 128
MAX_VALUE_BYTES = 16 * 1024
MAX_TITLE_CHARS = 200
MAX_BODY_CHARS = 8000
URGENCIES = ("normal", "urgent")
NO_RUN = "Bot tools only run inside a Timely bot tick."
NO_ANSWER = "Timely did not answer this tool call in time."

NOTE_KEY = {"type": "string", "description": f"Note name, up to {MAX_KEY_CHARS} characters."}
SCHEMAS: dict[str, dict[str, Any]] = {
    "bot_note_get": {
        "name": "bot_note_get",
        "description": "Read this bot's notepad: one note by key, or every note when no key is given. The notepad "
                       "is how this bot remembers things between runs.",
        "parameters": {"type": "object", "properties": {"key": NOTE_KEY}, "additionalProperties": False},
    },
    "bot_note_set": {
        "name": "bot_note_set",
        "description": "Save a note in this bot's notepad (keeps between runs; replaces the same key). Keep values "
                       f"short (up to {MAX_VALUE_BYTES // 1024} KB).",
        "parameters": {"type": "object", "properties": {"key": NOTE_KEY, "value": {"type": "string"}},
                       "required": ["key", "value"], "additionalProperties": False},
    },
    "bot_note_delete": {
        "name": "bot_note_delete",
        "description": "Delete one note from this bot's notepad.",
        "parameters": {"type": "object", "properties": {"key": NOTE_KEY}, "required": ["key"],
                       "additionalProperties": False},
    },
    "bot_report": {
        "name": "bot_report",
        "description": "Tell the person what you found. This is how an alert is sent: call it once per finding, "
                       "then end your reply. If there is nothing to report, do not call it; reply with exactly "
                       "[SILENT]. A change to the person's Timely data goes in proposal; it waits for their "
                       "approval and nothing is applied by this call.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "A short headline for the alert (under 120 characters)."},
                "body": {"type": "string", "description": "What changed and why it matters, plainly."},
                "url": {"type": "string", "description": "The page the finding is about."},
                "price": {"type": "number", "description": "The price seen, as a number, when it is about a price."},
                "symbol": {"type": "string", "description": "The currency or ticker of the price, e.g. INR."},
                "urgency": {"type": "string", "enum": list(URGENCIES),
                            "description": "urgent only when it cannot wait; quiet hours still apply."},
                "proposal": {
                    "type": "object",
                    "description": "Optional change to the person's Timely data, shown with the alert for approval.",
                    "properties": {
                        "summary": {"type": "string"},
                        "steps": {"type": "array", "items": {"type": "object", "properties": {
                            "tool": {"type": "string"}, "summary": {"type": "string"},
                            "arguments": {"type": "object"}}, "required": ["tool", "summary", "arguments"]}},
                    },
                    "required": ["summary", "steps"],
                },
            },
            "required": ["title", "body"],
            "additionalProperties": False,
        },
    },
    "bot_browser_read": {
        "name": "bot_browser_read",
        "description": "Open one web page in the person's signed-in browser and read it (text, or the accessibility "
                       "tree with mode=snapshot). Reading only: it cannot click, type, submit or run scripts. Only "
                       "sites the person gave this bot access to.",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "http(s) address of the page."},
            "mode": {"type": "string", "enum": ["text", "snapshot"], "description": "text (default) or snapshot."},
        }, "required": ["url"], "additionalProperties": False},
    },
}


def _error(message: str) -> str:
    return json.dumps({"error": message})


def _call_id() -> str:
    try:
        from tools.approval_context import _approval_tool_call_id
        return str(_approval_tool_call_id.get() or "")
    except Exception:
        return ""


def ask_go(run: bridge.RunContext, bot: runctx.BotRun, name: str, args: dict[str, Any]) -> Optional[dict]:
    """``tool.call`` to Go for this tick (scoped to the bot and check); the reply or None."""
    if bridge.ask is None:
        return None
    if run.flush is not None:
        try:
            run.flush()
        except Exception:
            pass
    msg = {"type": "tool.call", "run": run.run_id, "session_key": run.session_key, "tool_call_id": _call_id(),
           "name": name, "args": args, "tainted_sources": run.taint_snapshot(), "batch_size": 1,
           "sibling_tools": [], "bot": {"bot_id": bot.bot_id, "check_id": bot.check_id, "dry_run": bot.dry_run}}
    reply = bridge.ask(msg, bridge.TOOL_ANSWER_TIMEOUT_S)
    return reply if reply and reply.get("type") == "tool.result" else None


def _text(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result if result is not None else {}, ensure_ascii=False, default=str)


def _context() -> tuple[Optional[bridge.RunContext], Optional[runctx.BotRun]]:
    run = bridge.current_run.get()
    bot = runctx.get(run.run_id) if run is not None else None
    return run, bot


def _key(args: dict[str, Any]) -> str:
    key = args.get("key")
    return key.strip() if isinstance(key, str) else ""


def _notes_of(result: Any) -> dict[str, str]:
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except ValueError:
            return {}
    notes = result.get("notes") if isinstance(result, dict) else None
    if isinstance(notes, dict):
        return {str(k): str(v) for k, v in notes.items()}
    if isinstance(notes, list):
        return {str(n.get("key")): str(n.get("value")) for n in notes if isinstance(n, dict) and n.get("key")}
    if isinstance(result, dict) and "key" in result and result.get("value") is not None:
        return {str(result["key"]): str(result["value"])}
    return {}


def note_get(args: Any = None, **_: Any) -> str:
    run, bot = _context()
    if run is None or bot is None:
        return _error(NO_RUN)
    key = _key(args if isinstance(args, dict) else {})
    reply = ask_go(run, bot, "bot_note_get", {"key": key} if key else {})
    if reply is None:
        return _error(NO_ANSWER)
    result = reply.get("result")
    if bot.overlay:  # a dry run's own earlier writes
        notes = _notes_of(result)
        for k, v in bot.overlay.items():
            if v is None:
                notes.pop(k, None)
            else:
                notes[k] = v
        if key:
            return _text({"key": key, "value": notes.get(key)})
        return _text({"notes": notes})
    return _text(result)


def note_set(args: Any = None, **_: Any) -> str:
    run, bot = _context()
    if run is None or bot is None:
        return _error(NO_RUN)
    args = args if isinstance(args, dict) else {}
    key, value = _key(args), args.get("value")
    if not key:
        return _error("key must not be empty")
    if len(key) > MAX_KEY_CHARS:
        return _error(f"key is too long (up to {MAX_KEY_CHARS} characters)")
    if not isinstance(value, str):
        value = _text(value)
    if len(value.encode("utf-8")) > MAX_VALUE_BYTES:
        return _error(f"value is too large (up to {MAX_VALUE_BYTES // 1024} KB per note)")
    if bot.dry_run:
        bot.overlay[key] = value
        return _text({"ok": True, "key": key, "dry_run": True})
    reply = ask_go(run, bot, "bot_note_set", {"key": key, "value": value})
    return _error(NO_ANSWER) if reply is None else _text(reply.get("result"))


def note_delete(args: Any = None, **_: Any) -> str:
    run, bot = _context()
    if run is None or bot is None:
        return _error(NO_RUN)
    key = _key(args if isinstance(args, dict) else {})
    if not key:
        return _error("key must not be empty")
    if bot.dry_run:
        bot.overlay[key] = None
        return _text({"ok": True, "key": key, "dry_run": True})
    reply = ask_go(run, bot, "bot_note_delete", {"key": key})
    return _error(NO_ANSWER) if reply is None else _text(reply.get("result"))


def clean_report(args: Any) -> tuple[Optional[dict[str, Any]], str]:
    """``(report, "")`` for a well-formed ``bot_report`` call, else ``(None, why)``."""
    args = args if isinstance(args, dict) else {}
    title = args.get("title") if isinstance(args.get("title"), str) else ""
    body = args.get("body") if isinstance(args.get("body"), str) else ""
    if not title.strip() and not body.strip():
        return None, "a report needs a title or a body"
    out: dict[str, Any] = {"title": title.strip()[:MAX_TITLE_CHARS], "body": body.strip()[:MAX_BODY_CHARS]}
    url = args.get("url")
    if isinstance(url, str) and url.strip():
        if not url.strip().lower().startswith(("http://", "https://")):
            return None, "url must be an http(s) address"
        out["url"] = url.strip()[:2000]
    price = args.get("price")
    if price is not None:
        if isinstance(price, bool) or not isinstance(price, (int, float)) or price != price or abs(price) == float("inf"):
            return None, "price must be a number"
        out["price"] = price
    symbol = args.get("symbol")
    if isinstance(symbol, str) and symbol.strip():
        out["symbol"] = symbol.strip()[:16]
    urgency = args.get("urgency") or "normal"
    if urgency not in URGENCIES:
        return None, f"urgency must be one of {list(URGENCIES)}"
    out["urgency"] = urgency
    proposal = args.get("proposal")
    if proposal is not None:
        steps = proposal.get("steps") if isinstance(proposal, dict) else None
        if (not isinstance(proposal, dict) or not isinstance(proposal.get("summary"), str)
                or not isinstance(steps, list) or not steps
                or any(not isinstance(s, dict) or not isinstance(s.get("tool"), str)
                       or not isinstance(s.get("arguments"), dict) for s in steps)):
            return None, "proposal needs a summary and steps, each with a tool and arguments"
        out["proposal"] = {"summary": proposal["summary"][:500], "steps": steps[:30]}
    return out, ""


def report(args: Any = None, **_: Any) -> str:
    run, bot = _context()
    if run is None or bot is None:
        return _error(NO_RUN)
    clean, why = clean_report(args)
    if clean is None:
        return _error(why)
    with bot.lock:
        if len(bot.reports) >= policy.BOT_REPORTS_MAX:
            return _error(f"a run reports at most {policy.BOT_REPORTS_MAX} findings; fold the rest into one")
    if bot.dry_run:
        with bot.lock:
            bot.reports.append(clean)
        return _text({"ok": True, "recorded": True, "dry_run": True})
    reply = ask_go(run, bot, "bot_report", clean)
    if reply is None:
        return _error(NO_ANSWER)
    result = reply.get("result")
    if isinstance(result, dict) and result.get("error"):
        return _text(result)  # Go refused it (a cap, a shape): nothing is recorded
    with bot.lock:
        bot.reports.append(clean)
    return _text(result if result is not None else {"ok": True, "recorded": True})


def browser_read(args: Any = None, **kw: Any) -> str:
    run, bot = _context()
    if run is None or bot is None:
        return _error(NO_RUN)
    args = args if isinstance(args, dict) else {}
    url = args.get("url") if isinstance(args.get("url"), str) else ""
    mode = args.get("mode") if args.get("mode") in ("text", "snapshot") else "text"
    if not url.strip().lower().startswith(("http://", "https://")):
        return _error("url must be an http(s) address")
    if run.stopping:
        return _error(policy.STOPPED)
    from timely_agent.plugins.timely_bot import browser
    return _text(browser.read(url.strip(), mode, bot, task_id=kw.get("task_id")))


HANDLERS: dict[str, Callable[..., str]] = {
    "bot_note_get": note_get, "bot_note_set": note_set, "bot_note_delete": note_delete,
    "bot_report": report, "bot_browser_read": browser_read,
}

"""``bot_browser_read``: read one page on the person's real signed-in browser profile (Q-B2).

In this Hermes copy the browser is ``browser_exec``: Python over CDP, run through the Browser Use
CLI on whichever browser ``tools.browser_session`` resolved. The bot's read path is a Timely tool
that runs one **fixed** script through that same function (``tools.browser_use_cli.browser_exec``,
``local=True``: the account's real-profile copy, ``HERMES_REAL_HOME``, runtime override R7). The
model supplies only the URL, which is embedded as a JSON string literal; it cannot supply code, a
selector, text to type or anything to click, so a read can never submit a form.

The script navigates (``new_tab``), waits for the load, reads ``document.body.innerText`` (or the
accessibility tree's named nodes for ``mode=snapshot``), and prints one JSON line behind a marker.
The tab it opened is closed again, so ticks do not pile tabs up on the person's browser.

``browser_exec`` itself is unchanged and is *not* what the model calls: Hermes offers it only next to
``terminal``, which a bot never has, and ``timely_gate`` parks any call to it (Q-B2).
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Optional

from timely_agent.plugins.timely_bot import runctx

MARK = "@@TIMELY_BOT_READ@@"
MAX_TEXT_CHARS = 24_000
MAX_SNAPSHOT_NODES = 400
TIMEOUT_S = 90
SESSION_PREFIX = "bot-"

SCRIPT = '''# Reading a page for a bot
import json as _json
_url = {url}
_mode = {mode}
_tid = new_tab(_url)
wait_for_load()
_title = js("document.title")
_final = js("location.href")
if _mode == "snapshot":
    _nodes = []
    for _n in cdp("Accessibility.getFullAXTree").get("nodes", []):
        _role = ((_n.get("role") or {{}}).get("value") or "")
        _name = ((_n.get("name") or {{}}).get("value") or "")
        if _name and _role not in ("none", "generic", "InlineTextBox", "StaticText", "LineBreak"):
            _nodes.append(_role + ": " + str(_name)[:300])
        if len(_nodes) >= {nodes}:
            break
    _body = "\\n".join(_nodes)
else:
    _body = js("document.body ? document.body.innerText : ''") or ""
print({mark} + _json.dumps({{"title": _title, "url": _final, "mode": _mode, "text": _body[:{chars}]}}))
try:
    cdp("Target.closeTarget", targetId=_tid if isinstance(_tid, str) else (_tid or {{}}).get("targetId"))
except Exception:
    pass
'''


def session_name(bot_id: str) -> str:
    """A Browser Use session name for this bot (1-64 letters, digits, dashes, underscores)."""
    clean = re.sub(r"[^A-Za-z0-9_-]+", "-", bot_id).strip("-")[:40] or "bot"
    return SESSION_PREFIX + clean


def script_for(url: str, mode: str) -> str:
    return SCRIPT.format(url=json.dumps(url), mode=json.dumps(mode if mode in ("text", "snapshot") else "text"),
                         nodes=MAX_SNAPSHOT_NODES, chars=MAX_TEXT_CHARS, mark=json.dumps(MARK))


def parse(raw: Any) -> dict[str, Any]:
    """The tool result of ``browser_exec`` as a read result: ``{title, url, text}`` or ``{error}``."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else dict(raw)
    except (ValueError, TypeError):
        return {"error": "the browser returned something unreadable"}
    if data.get("error"):
        return {"error": str(data["error"])[:1000]}
    output = str(data.get("output") or "")
    for line in output.splitlines():
        if line.startswith(MARK):
            try:
                page = json.loads(line[len(MARK):])
            except ValueError:
                break
            out = {"title": page.get("title"), "url": page.get("url"), "mode": page.get("mode"),
                   "text": page.get("text")}
            note = data.get("real_profile_unavailable")
            if note:
                out["note"] = "the signed-in profile could not be used, so this page was read signed out"
            return out
    if data.get("success") is False or data.get("exit_code"):
        stderr = str(data.get("stderr") or output)[-600:]
        return {"error": "the browser could not read the page: " + stderr.strip()[:600]}
    return {"error": "the browser returned no page text"}


def read(url: str, mode: str, bot: runctx.BotRun, task_id: Optional[str] = None,
         exec_fn: Optional[Callable[..., Any]] = None) -> dict[str, Any]:
    """Open ``url`` and return its text. ``exec_fn`` is Hermes' ``browser_exec`` (injected in tests)."""
    if exec_fn is None:
        try:
            from tools.browser_use_cli import browser_exec as exec_fn
        except Exception as exc:  # Hermes' browser tool did not load
            return {"error": f"the browser is not available here ({type(exc).__name__})"}
    host = runctx.norm_host(url)
    bot.note_host(host)
    try:
        raw = exec_fn(code=script_for(url, mode), session=session_name(bot.bot_id), timeout_s=TIMEOUT_S,
                      task_id=task_id, local=True)
    except Exception as exc:  # noqa: BLE001 - a browser failure is the model's result, not a crash
        return {"error": f"the browser failed: {type(exc).__name__}: {exc}"[:600]}
    return parse(raw)

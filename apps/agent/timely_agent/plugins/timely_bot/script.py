"""``bot_browser_exec`` and ``bot_browser_dialog``: a Bot's script and dialog tools, offered only
through the gate and always parked (Q-B2).

Hermes offers its own ``browser_exec`` only next to ``terminal``, which a Bot never has, so a tick
would never see a script tool and "a script parks in Needs you while the next Check runs" could not
happen. These two tools are the Bot's own, in toolset ``timely_bot``:

- ``bot_browser_exec(code)``: Python over CDP on the person's real signed-in profile, run through
  Hermes' ``tools.browser_use_cli.browser_exec`` with ``local=True`` (the account's real-profile
  copy, runtime override R7) and the Bot's own browser session (``browser.session_name``).
- ``bot_browser_dialog(action, prompt_text?)``: accept or dismiss a page's native dialog through
  Hermes' ``tools.browser_dialog_tool.browser_dialog``.

Every call in a tick goes to Go over ``gate.ask`` with ``bot.park: true`` (``egress.decide``); Go
answers ``approve`` in every mode, Full Access included, the gate refuses the call with the
"parked" message and ``bot.done.parked`` lists it, so the card waits in Needs you and the tick goes
on. Run once starts a continuation whose ``pre_approved`` names exactly that call (tool and
``args_hash``): only then does ``egress.decide`` mark the call (``BotRun.allow_script``), the gate
lets it through without asking, and the handler runs it, once. The handler runs nothing it was not
marked for, so a Go ``allow`` (which Go never sends for these) still runs nothing outside a
continuation.

``EXEC_FN`` and ``DIALOG_FN`` replace Hermes' functions in contract tests, which never start a
browser; production leaves them ``None``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from timely_agent import bridge, policy
from timely_agent.plugins.timely_bot import runctx

EXEC = "bot_browser_exec"
DIALOG = "bot_browser_dialog"
TOOLS = policy.BOT_SCRIPT_TOOLS
HERMES_TOOL = {EXEC: "browser_exec", DIALOG: "browser_dialog"}
TIMEOUT_S = 120
MAX_CODE_CHARS = 20_000
DIALOG_ACTIONS = ("accept", "dismiss")

EXEC_FN: Optional[Callable[..., Any]] = None
DIALOG_FN: Optional[Callable[..., Any]] = None

NO_RUN = "Bot tools only run inside a Timely bot tick."
NOT_APPROVED = ("Blocked: {tool} runs only once the person approved this exact call in Needs you. It was "
                "not run.")
DRY_RUN = "Blocked: Try it now does not run scripts or answer dialogs in your browser."

SCHEMAS: dict[str, dict[str, Any]] = {
    EXEC: {
        "name": EXEC,
        "description": "Run a short Python script in the person's signed-in browser (helpers such as new_tab(url), "
                       "wait_for_load(), js(expr), click(selector), type_text(text); print what you need back). "
                       "It can click, type and submit, so every call waits for the person's approval in Needs you "
                       "and is not run in this check: call it once, then say in bot_report that it is waiting. "
                       "Prefer bot_browser_read to just read a page.",
        "parameters": {"type": "object", "properties": {
            "code": {"type": "string", "description": "Python using the browser helpers."},
        }, "required": ["code"], "additionalProperties": False},
    },
    DIALOG: {
        "name": DIALOG,
        "description": "Accept or dismiss a native dialog (alert, confirm, prompt) blocking a page in the person's "
                       "signed-in browser. Every call waits for the person's approval in Needs you and is not run "
                       "in this check.",
        "parameters": {"type": "object", "properties": {
            "action": {"type": "string", "enum": list(DIALOG_ACTIONS)},
            "prompt_text": {"type": "string", "description": "The answer to a prompt() dialog."},
        }, "required": ["action"], "additionalProperties": False},
    },
}


def _error(message: str) -> str:
    return json.dumps({"error": message})


def _call_id(kw: dict[str, Any]) -> str:
    cid = kw.get("tool_call_id")
    if isinstance(cid, str) and cid:
        return cid
    try:
        from tools.approval_context import _approval_tool_call_id
        return str(_approval_tool_call_id.get() or "")
    except Exception:
        return ""


def _text(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result if result is not None else {}, ensure_ascii=False, default=str)


def _approved(tool: str, args: dict[str, Any], kw: dict[str, Any]) -> tuple[Optional[runctx.BotRun], str]:
    """The tick's BotRun when this call is the continuation's approved one, else ``(None, why)``."""
    run = bridge.current_run.get()
    bot = runctx.get(run.run_id) if run is not None else None
    if run is None or bot is None:
        return None, NO_RUN
    if run.stopping:
        return None, policy.STOPPED
    if bot.dry_run:
        return None, DRY_RUN
    call_id = _call_id(kw)
    if not bot.take_script(tool, policy.args_hash(args)) or (call_id and not run.is_approved(call_id)):
        return None, NOT_APPROVED.format(tool=tool)
    return bot, ""


def browser_exec(args: Any = None, **kw: Any) -> str:
    args = args if isinstance(args, dict) else {}
    code = args.get("code") if isinstance(args.get("code"), str) else ""
    if not code.strip():
        return _error("code must not be empty")
    if len(code) > MAX_CODE_CHARS:
        return _error(f"code is too long (up to {MAX_CODE_CHARS} characters)")
    bot, why = _approved(EXEC, args, kw)
    if bot is None:
        return _error(why)
    fn = EXEC_FN
    if fn is None:
        try:
            from tools.browser_use_cli import browser_exec as fn
        except Exception as exc:  # Hermes' browser tool did not load
            return _error(f"the browser is not available here ({type(exc).__name__})")
    from timely_agent.plugins.timely_bot import browser
    for url in runctx.urls_in(code):
        bot.note_host(runctx.norm_host(url))
    try:
        return _text(fn(code=code, session=browser.session_name(bot.bot_id), timeout_s=TIMEOUT_S,
                        task_id=kw.get("task_id"), local=True))
    except Exception as exc:  # noqa: BLE001 - a browser failure is the model's result, not a crash
        return _error(f"the browser failed: {type(exc).__name__}: {exc}"[:600])


def browser_dialog(args: Any = None, **kw: Any) -> str:
    args = args if isinstance(args, dict) else {}
    action = args.get("action")
    if action not in DIALOG_ACTIONS:
        return _error(f"action must be one of {list(DIALOG_ACTIONS)}")
    prompt_text = args.get("prompt_text") if isinstance(args.get("prompt_text"), str) else None
    bot, why = _approved(DIALOG, args, kw)
    if bot is None:
        return _error(why)
    fn = DIALOG_FN
    if fn is None:
        try:
            from tools.browser_dialog_tool import browser_dialog as fn
        except Exception as exc:
            return _error(f"the browser is not available here ({type(exc).__name__})")
    try:
        return _text(fn(action=action, prompt_text=prompt_text, task_id=kw.get("task_id")))
    except Exception as exc:  # noqa: BLE001
        return _error(f"the browser failed: {type(exc).__name__}: {exc}"[:600])


HANDLERS: dict[str, Callable[..., str]] = {EXEC: browser_exec, DIALOG: browser_dialog}

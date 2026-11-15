"""timely_bot: bot-run tools and the ``cronjob_manage`` shim (plan sections 7.5, 7.10; phase 6).

- ``bot_note_get``, ``bot_note_set``, ``bot_note_delete``, ``bot_report`` and ``bot_browser_read``
  (``tools.py``, ``browser.py``), toolset ``timely_bot``, offered only to a Bot tick (``run_bot``).
- the ``cronjob_manage`` shim (``cronjob_shim.py``), registered with ``override=True`` in toolset
  ``timely_schedule`` (the managed config grants ``plugins.entries.timely_bot.allow_tool_override`` to
  this plugin only): "create a job" becomes a ``create_bot`` / ``update_bot`` proposal.
- ``transform_tool_result``: a page ``bot_browser_read`` returned and the notes ``bot_note_get``
  returned reach the model wrapped as untrusted data (agent-written notes count as untrusted).
- ``egress.py`` and ``runctx.py``: the bot egress policy ``timely_gate`` applies in a tick.

Everything the tick may reach is decided in ``timely_gate`` (``egress.decide``) before these tools
run; the tools never widen it.
"""

from __future__ import annotations

import logging
from typing import Any

PLUGIN = "timely_bot"
UNTRUSTED_RESULTS = ("bot_browser_read", "bot_note_get")

logger = logging.getLogger("timely_agent.plugins.timely_bot")
registered: list[str] = []  # what register() added, for the self-test


def transform_tool_result(tool_name: str = "", result: Any = None, tool_call_id: str = "", **_: Any):
    """Wrap a page or a note as untrusted data; None leaves the result as it is."""
    if tool_name not in UNTRUSTED_RESULTS or not isinstance(result, str):
        return None
    from timely_agent import bridge, untrusted
    run = bridge.current_run.get()
    if run is None:
        return None
    return untrusted.mark(run, tool_name, tool_call_id, result)


def register(ctx) -> None:
    from timely_agent.plugins.timely_bot import cronjob_shim, tools
    registered.clear()
    ctx.register_hook("transform_tool_result", transform_tool_result)
    for name, schema in tools.SCHEMAS.items():
        handle = ctx.register_tool(name=name, toolset=tools.TOOLSET, schema=schema, handler=tools.HANDLERS[name],
                                   description=schema["description"])
        if handle is None:
            logger.error("bot tool %s was not registered (its name is taken)", name)
            continue
        registered.append(name)
    if cronjob_shim.register(ctx) is None:
        logger.error("the cronjob_manage shim was not registered")
    else:
        registered.append(cronjob_shim.TOOL)

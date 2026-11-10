"""timely_bot: bot-run tools and the ``cronjob_manage`` shim (plan sections 7.5, 7.10). Stub in phase 1.

Phase 6 registers ``bot_note_*``, ``bot_report`` and ``bot_browse``, and replaces Hermes'
``cronjob_manage`` with a shim (``override=True``; the managed config grants
``plugins.entries.timely_bot.allow_tool_override`` to this plugin only) that turns "create a
job" into a bot proposal.
"""

from __future__ import annotations

PLUGIN = "timely_bot"


def register(ctx) -> None:
    """Phase 1: loaded and visible to the self-test, registers nothing yet."""
    return None

"""timely_tools: Timely's data tools as Hermes tools (plan section 5.2). Stub in phase 1.

Phase 2 fetches the chat-visible tool specs from Go at ``hello`` and registers each with
``ctx.register_tool`` under toolset ``timely``; every call goes to Go as ``tool.call``. Write
tools are never registered: they only arrive inside ``propose_changes``.
"""

from __future__ import annotations

PLUGIN = "timely_tools"
TOOLSET = "timely"


def register(ctx) -> None:
    """Phase 1: loaded and visible to the self-test, registers nothing yet."""
    return None

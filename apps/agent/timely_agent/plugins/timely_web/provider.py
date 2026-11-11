"""The ``timely`` web search and extract provider (Q-3.8): Go answers both, the worker opens no socket.

Imported by ``register`` only, once Hermes is loaded (it subclasses Hermes' provider ABC).
"""

from __future__ import annotations

import logging
from typing import Any

from agent.web_search_provider import WebSearchProvider

from timely_agent import bridge
from timely_agent.plugins.timely_web import mapping

logger = logging.getLogger("timely_agent.plugins.timely_web")

NAME = "timely"
NO_RUN = "Web search runs only inside a Timely chat."
NO_ANSWER = "Timely did not answer {name} in time."


def _call(name: str, args: dict) -> tuple[Any, str]:
    """``(result, "")`` from Go, or ``(None, error)``. The run is this thread's (Hermes carries the
    run's context into tool threads); ``tool_call`` reports an ``outside`` answer as taint."""
    run = bridge.current_run.get()
    if run is None:
        return None, NO_RUN
    try:
        result, _outside = run.tool_call(name, args)
    except TimeoutError:
        return None, NO_ANSWER.format(name=name)
    return result, ""


class TimelyWebProvider(WebSearchProvider):
    """Search and extract through Go (``tool.call web_search`` / ``web_extract``, PROTOCOL.md 10.7)."""

    @property
    def name(self) -> str:
        return NAME

    @property
    def display_name(self) -> str:
        return "Timely"

    def is_available(self) -> bool:
        # No key and no network: Go decides each call (flags.web through gate.ask, then its own
        # caps). Always available, so Hermes offers web_search / web_extract when the run's
        # toolsets include "web".
        return True

    def supports_search(self) -> bool:
        return True

    def supports_extract(self) -> bool:
        return True

    def search(self, query: str, limit: int = 5) -> dict[str, Any]:
        try:
            limit = max(int(limit), 1)
        except (TypeError, ValueError):
            limit = 5
        result, error = _call("web_search", {"query": str(query or ""), "limit": limit})
        if error:
            return mapping.search_fail(error)
        return mapping.search(result, limit)

    def extract(self, urls: list[str], **_: Any) -> list[dict[str, Any]]:
        urls = [str(u) for u in urls or []]
        if not urls:
            return []
        result, error = _call("web_extract", {"urls": urls})
        if error:
            return [mapping.page_error(u, error) for u in urls]
        return mapping.extract(urls, result)

    def get_setup_schema(self) -> dict[str, Any]:
        return {"name": "Timely", "badge": "built in", "tag": "Search and pages through Timely.", "env_vars": []}

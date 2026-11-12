"""timely_web: the ``timely`` web search and extract backend (plan 3.2, 8.2, 8.4; Q-3.8).

The model calls Hermes' own ``web_search`` / ``web_extract``; with ``web.search_backend`` /
``web.extract_backend`` set to ``timely`` (the rendered default) Hermes hands the call to this
provider, which asks Go over ``tool.call`` (``RunContext.tool_call``) and maps the answer to
Hermes' result shapes. Go runs the search with the chat provider's own search and fetches pages
through its netguard; the worker opens no connection for this backend. Hermes' own controls stay
in front of it (secret-in-URL refusal, the SSRF floor, truncation, caches; the website blocklist
is Hermes' opt-in list, empty in Timely). See README.md for what Go answers and its section
"After the chat read outside content (Q-3.9)" for what holds once a chat read outside content.
"""

from __future__ import annotations


def register(ctx) -> None:
    from timely_agent.plugins.timely_web.provider import TimelyWebProvider
    ctx.register_web_search_provider(TimelyWebProvider())

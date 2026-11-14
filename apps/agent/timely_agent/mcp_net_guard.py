"""Remote MCP servers never reach a private address, by redirect or by OAuth metadata (phase 5
review finding; runtime override R8).

Go checks a remote MCP server's saved address before every spawn (``agentmcp.validate``), but that
checks one host. Hermes' MCP clients follow redirects (``follow_redirects=True`` on the streamable
HTTP client, the SSE client and the probe), and the SDK's OAuth flow fetches discovery, registration
and token URLs the *server* names, through the same client. A public server that answers ``307
Location: http://127.0.0.1:...`` or names ``http://169.254.169.254/`` as its authorization server would
make the worker call loopback, the LAN or cloud metadata. Hermes' MCP transport never calls
``url_safety`` (its SSRF floor is for its own web tools).

``install`` wraps the two factories every MCP HTTP client is built through
(``tools.mcp_tool_transport._make_mcp_body_cap_transport`` for the streamable and SSE clients and the
proxy mounts, ``_make_redirect_header_stripper`` for the probe) so the client's transport refuses a
request, including each redirect hop and each OAuth request, whose host Hermes' own
``url_safety.is_safe_url`` calls private, loopback, link-local, CGNAT or metadata. The refusal is a
``ConnectError`` the server row shows like any failed connection. A name that resolves to a public
address when checked and to a private one when connected (DNS rebinding) stays the plan's residual
(section 14): the check resolves, the transport resolves again.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger("timely_agent.mcp_net_guard")

_MARK = "_timely_mcp_net_guard"
REFUSED = "Timely does not connect an MCP server to a private, local or internal address ({host})"


# Test hook only (``tests/contract/probe_boot.py --mcp-loopback``): the MCP tests' local fake servers
# listen on loopback, which this guard exists to refuse. Never set outside a test; a worker that
# boots through ``boot.py`` has no way to turn it on.
LOOPBACK_OK_FOR_TESTS = False


def _default_is_safe(url: str) -> bool:
    if LOOPBACK_OK_FOR_TESTS:
        from urllib.parse import urlsplit
        if (urlsplit(url).hostname or "") in ("127.0.0.1", "localhost", "::1"):
            return True
    from tools.url_safety import is_safe_url
    return bool(is_safe_url(url))


_classes: dict[int, type] = {}


def guard_class(httpx_mod: Any) -> type:
    """A transport class over ``httpx_mod``'s ``AsyncBaseTransport`` (the SDK may use ``httpx2``)."""
    cls = _classes.get(id(httpx_mod))
    if cls is not None:
        return cls

    class GuardTransport(httpx_mod.AsyncBaseTransport):
        def __init__(self, inner: Any, is_safe: Callable[[str], bool] | None = None) -> None:
            self._inner = inner
            self._is_safe = is_safe or _default_is_safe
            setattr(self, _MARK, True)

        async def handle_async_request(self, request: Any) -> Any:
            url = str(request.url)
            try:
                safe = await asyncio.get_running_loop().run_in_executor(None, self._is_safe, url)
            except Exception as exc:  # fail closed
                logger.warning("MCP address check failed for %s: %s", request.url.host, exc)
                safe = False
            if not safe:
                logger.warning("MCP request to %s refused (private or internal address)", request.url.host)
                raise httpx_mod.ConnectError(REFUSED.format(host=request.url.host), request=request)
            return await self._inner.handle_async_request(request)

        async def aclose(self) -> None:
            await self._inner.aclose()

        async def __aenter__(self) -> Any:
            await self._inner.__aenter__()
            return self

        async def __aexit__(self, *exc_info: Any) -> None:
            await self._inner.__aexit__(*exc_info)

    _classes[id(httpx_mod)] = GuardTransport
    return GuardTransport


def guarded(httpx_mod: Any, transport: Any, is_safe: Callable[[str], bool] | None = None) -> Any:
    """``transport`` behind the address check (itself when it already is)."""
    if transport is None or getattr(transport, _MARK, False):
        return transport
    return guard_class(httpx_mod)(transport, is_safe)


def install() -> None:
    """Wrap the MCP transport's client factories (idempotent)."""
    import tools.mcp_tool_transport as transport
    if getattr(transport._make_mcp_body_cap_transport, _MARK, False):
        return
    cap = transport._make_mcp_body_cap_transport
    strip = transport._make_redirect_header_stripper

    def guarded_cap(httpx_mod, inner_transport, *args, **kwargs):
        return cap(httpx_mod, guarded(httpx_mod, inner_transport), *args, **kwargs)

    def guarded_strip(httpx_mod, *args, **kwargs):
        build = strip(httpx_mod, *args, **kwargs)

        def build_client(**client_kwargs):
            if client_kwargs.get("transport") is not None:  # the probe's: the cap's is guarded already
                client_kwargs["transport"] = guarded(httpx_mod, client_kwargs["transport"])
            return build(**client_kwargs)

        return build_client

    setattr(guarded_cap, _MARK, True)
    setattr(guarded_strip, _MARK, True)
    transport._make_mcp_body_cap_transport = guarded_cap
    transport._make_redirect_header_stripper = guarded_strip


def active() -> bool:
    try:
        import tools.mcp_tool_transport as transport
        return bool(getattr(transport._make_mcp_body_cap_transport, _MARK, False)
                    and getattr(transport._make_redirect_header_stripper, _MARK, False))
    except Exception:
        return False

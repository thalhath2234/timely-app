"""Review finding (phase 5): a remote MCP server must not make the worker reach a private address by
redirect or through the OAuth metadata it names (runtime override R8, ``timely_agent.mcp_net_guard``).

The address check is injected here (a name list), so no test touches the network and no Hermes module
is imported; the contract test ``test_c_host.py::test_mcp_probe_refuses_a_private_address`` runs the
real worker's probe against a local listener."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from timely_agent import mcp_net_guard

PUBLIC = {"public.test", "auth.public.test"}


def safe(url: str) -> bool:
    return httpx.URL(url).host in PUBLIC


def client_for(handler, **kw) -> httpx.AsyncClient:
    inner = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=mcp_net_guard.guarded(httpx, inner, safe), follow_redirects=True, **kw)


def run(coro):
    return asyncio.run(coro)


def test_a_public_server_that_redirects_to_loopback_is_refused_at_the_hop():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "public.test":
            return httpx.Response(307, headers={"Location": "http://127.0.0.1:8081/internal"})
        return httpx.Response(200, text="reached the internal service")

    async def go():
        async with client_for(handler) as client:
            with pytest.raises(httpx.ConnectError, match="private, local or internal address"):
                await client.post("https://public.test/mcp", content=b"{}")

    run(go())
    assert seen == ["https://public.test/mcp"], seen  # the loopback hop never reached the inner transport


@pytest.mark.parametrize("target", ["http://169.254.169.254/latest/meta-data", "http://10.0.0.5/x", "http://[::1]/x",
                                    "http://100.64.0.9/x", "http://localhost:8081/x"])
def test_oauth_metadata_naming_a_private_address_is_refused(target):
    """The SDK fetches discovery, registration and token URLs through the same client."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"authorization_servers": [target]})

    async def go():
        async with client_for(handler) as client:
            r = await client.get("https://public.test/.well-known/oauth-protected-resource")
            assert r.status_code == 200
            with pytest.raises(httpx.ConnectError):
                await client.get(r.json()["authorization_servers"][0])

    run(go())
    assert seen == ["https://public.test/.well-known/oauth-protected-resource"]


def test_public_to_public_redirects_and_oauth_still_work():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "public.test":
            return httpx.Response(307, headers={"Location": "https://auth.public.test/token"})
        return httpx.Response(200, text="ok")

    async def go():
        async with client_for(handler) as client:
            r = await client.get("https://public.test/x")
            assert r.status_code == 200 and r.text == "ok"

    run(go())


def test_a_failing_check_fails_closed_and_guarding_twice_is_one_guard():
    def boom(url: str) -> bool:
        raise RuntimeError("resolver down")

    inner = httpx.MockTransport(lambda request: httpx.Response(200))
    once = mcp_net_guard.guarded(httpx, inner, boom)
    assert mcp_net_guard.guarded(httpx, once) is once and mcp_net_guard.guarded(httpx, None) is None

    async def go():
        async with httpx.AsyncClient(transport=once) as client:
            with pytest.raises(httpx.ConnectError):
                await client.get("https://public.test/x")

    run(go())

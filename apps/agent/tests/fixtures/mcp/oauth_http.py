"""A local HTTP MCP server behind a fake OAuth issuer, for the mcp_admin tests. Never leaves
127.0.0.1, signs nobody in anywhere and sends nothing (decision 20).

    <venv python> -I oauth_http.py [--open]

Prints ``LISTENING <port>`` once it accepts connections. The issuer, on the same port:

- ``/.well-known/oauth-protected-resource`` and ``/.well-known/oauth-authorization-server``
- ``POST /register`` (dynamic client registration), ``GET /authorize`` (answers the redirect
  Location a browser would follow, with code ``good-code`` and the request's state),
  ``POST /token`` (authorization_code with PKCE, and refresh_token)

``/mcp`` answers 401 with ``WWW-Authenticate: Bearer resource_metadata=...`` until a request
carries a token this issuer minted; ``--open`` serves it without auth. Tools: ``search_notes``
(read-only), ``send_message`` (a name that sends, no annotations), ``delete_note`` (destructive)
and ``post_status`` (openWorld). ``GET /_state`` reports the registrations, codes and tokens seen.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import secrets
import sys
import threading
import time
from urllib.parse import urlencode

import uvicorn
from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

OPEN = "--open" in sys.argv
GOOD_CODE = "good-code"
STATE: dict = {"registrations": [], "codes": {}, "tokens": {}, "refreshes": 0}
LOCK = threading.Lock()

mcp = MCPServer("fake-oauth-http")


@mcp.tool(name="search_notes", description="Search notes (read-only).",
          annotations=ToolAnnotations(readOnlyHint=True))
def search_notes(query: str) -> str:
    return f"notes matching {query!r}: none"


@mcp.tool(name="send_message", description="Pretend to send a message (sends nothing).")
def send_message(to: str, body: str) -> str:
    return f"would send to {to}"


@mcp.tool(name="delete_note", description="Pretend to delete a note.",
          annotations=ToolAnnotations(destructiveHint=True))
def delete_note(id: str) -> str:
    return f"would delete {id}"


@mcp.tool(name="post_status", description="Pretend to post a status.",
          annotations=ToolAnnotations(openWorldHint=True, readOnlyHint=False))
def post_status(text: str) -> str:
    return f"would post {text!r}"


def base(request: Request) -> str:
    return f"http://{request.headers['host']}"


async def protected_resource(request: Request) -> Response:
    b = base(request)
    return JSONResponse({"resource": f"{b}/mcp", "authorization_servers": [b], "bearer_methods_supported": ["header"]})


async def auth_server(request: Request) -> Response:
    b = base(request)
    return JSONResponse({
        "issuer": b, "authorization_endpoint": f"{b}/authorize", "token_endpoint": f"{b}/token",
        "registration_endpoint": f"{b}/register", "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["none"],
    })


async def register(request: Request) -> Response:
    body = await request.json()
    client_id = "client-" + secrets.token_hex(4)
    with LOCK:
        STATE["registrations"].append({"client_id": client_id, "redirect_uris": body.get("redirect_uris")})
    return JSONResponse({**body, "client_id": client_id, "token_endpoint_auth_method": "none"}, status_code=201)


async def authorize(request: Request) -> Response:
    q = request.query_params
    with LOCK:
        STATE["codes"][GOOD_CODE] = {"challenge": q.get("code_challenge"), "redirect_uri": q.get("redirect_uri"),
                                     "client_id": q.get("client_id")}
    params = {"code": GOOD_CODE, "state": q.get("state", "")}
    return Response(status_code=302, headers={"Location": f"{q['redirect_uri']}?{urlencode(params)}"})


def mint() -> dict:
    token = "at-" + secrets.token_hex(8)
    with LOCK:
        STATE["tokens"][token] = time.time() + 3600
    return {"access_token": token, "token_type": "Bearer", "expires_in": 3600, "refresh_token": "rt-" + secrets.token_hex(8)}


async def token(request: Request) -> Response:
    form = await request.form()
    grant = form.get("grant_type")
    if grant == "authorization_code":
        with LOCK:
            known = STATE["codes"].get(form.get("code"))
        if not known:
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        verifier = str(form.get("code_verifier") or "")
        digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if known["challenge"] and digest != known["challenge"]:
            return JSONResponse({"error": "invalid_grant", "error_description": "PKCE mismatch"}, status_code=400)
        return JSONResponse(mint())
    if grant == "refresh_token":
        with LOCK:
            STATE["refreshes"] += 1
        return JSONResponse(mint())
    return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)


async def state(request: Request) -> Response:
    with LOCK:
        return JSONResponse({**STATE, "tokens": sorted(STATE["tokens"])})


class Bearer:
    """ASGI wrapper: 401 unless the request carries a token this issuer minted."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or OPEN:
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        bearer = headers.get("authorization", "")[7:]
        with LOCK:
            ok = bearer in STATE["tokens"]
        if ok:
            return await self.app(scope, receive, send)
        meta = f"http://{headers.get('host', '')}/.well-known/oauth-protected-resource"
        resp = Response("unauthorized", status_code=401,
                        headers={"WWW-Authenticate": f'Bearer resource_metadata="{meta}"'})
        await resp(scope, receive, send)


def build() -> Starlette:
    inner = mcp.streamable_http_app(host="127.0.0.1")

    @contextlib.asynccontextmanager
    async def lifespan(_app):  # the inner app's session manager starts here, not in the mount
        async with inner.router.lifespan_context(inner):
            yield

    return Starlette(lifespan=lifespan, routes=[
        Route("/.well-known/oauth-protected-resource", protected_resource),
        Route("/.well-known/oauth-protected-resource/mcp", protected_resource),
        Route("/.well-known/oauth-authorization-server", auth_server),
        Route("/register", register, methods=["POST"]),
        Route("/authorize", authorize),
        Route("/token", token, methods=["POST"]),
        Route("/_state", state),
        Mount("/", app=Bearer(inner)),
    ])


def main() -> None:
    config = uvicorn.Config(build(), host="127.0.0.1", port=0, log_level="error", lifespan="on")
    server = uvicorn.Server(config)

    def announce() -> None:
        while not server.started:
            time.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        print(f"LISTENING {port}", flush=True)

    threading.Thread(target=announce, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()

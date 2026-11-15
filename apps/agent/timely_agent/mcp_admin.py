"""External MCP servers: the catalog, a tool probe and OAuth sign-in (phase 5, decision 14; PROTOCOL.md
section 12.7). Go's ``agentmcp`` package sends ``mcp.catalog``, ``mcp.probe``, ``mcp.oauth.begin`` and
``mcp.oauth.finish``; ``worker.py`` routes them here. Each function is ``f(fields: dict, home: Path) ->
dict`` and runs on a thread of its own inside the account's worker, after ``ready`` (Hermes imported,
``HERMES_HOME`` is the account home). A ``ValueError`` becomes ``error bad_message`` with its text.

- ``catalog``: Hermes' curated remote servers (``optional-mcps``), each with the entry Go stores when
  the person adds it. Hermes' manifests carry no category; ``CATEGORY`` below does (Q-5.6: the whole
  catalog, messaging-category servers included, flagged).
- ``probe``: connect, list the tools with their annotations, disconnect. A remote server that wants a
  sign-in answers ``needs_sign_in``. A ``command`` entry only runs for a host-allowed account (Go
  probes it only after the person approved it on a host card).
- ``oauth_begin`` / ``oauth_finish``: Hermes' dashboard-mediated OAuth bridge (``tools/mcp_dashboard_oauth``):
  the SDK does discovery, registration, PKCE and the token exchange; Timely's origin receives the
  browser's redirect and Go hands the ``code`` to ``oauth_finish``. The worker's token files
  (``mcp-tokens/``) are the normal ones: Go also gets the token back so it can keep the durable,
  encrypted copy.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

logger = logging.getLogger("timely_agent.mcp_admin")

# Hermes' manifests have no category field; this is Timely's. A server added to the catalog upstream
# without an entry here is shown as "other" until it is named.
CATEGORY: dict[str, str] = {
    "airtable": "data", "algolia": "data", "amplitude": "analytics", "mixpanel": "analytics",
    "datadog": "operations", "grafana": "operations", "betterstack": "operations", "sentry": "operations",
    "buildkite": "developer", "circleci": "developer", "gitlab": "developer", "semgrep": "developer",
    "postman": "developer", "context7": "developer", "deepwiki": "developer", "hugging_face": "developer",
    "aws-knowledge": "docs", "microsoft-learn": "docs", "twilio-docs": "docs", "wolfram": "reference",
    "atlassian": "projects", "asana": "projects", "clickup": "projects", "linear": "projects",
    "monday": "projects", "todoist": "projects", "notion": "docs", "craft": "docs", "miro": "design",
    "canva": "design", "figma": "design", "gamma": "design", "cloudinary": "design", "comfy-cloud": "design",
    "dropbox": "files", "fireflies": "meetings", "calendly": "scheduling",
    "attio": "crm", "close": "messaging", "intercom": "messaging", "klaviyo": "messaging",
    "cloudflare": "infrastructure", "neon": "infrastructure", "netlify": "infrastructure",
    "prisma-postgres": "infrastructure", "railway": "infrastructure", "supabase": "infrastructure",
    "vercel": "infrastructure", "webflow": "infrastructure", "wordpress-com": "infrastructure",
    "motherduck": "data", "n8n-official": "automation", "globalping": "operations",
    "paypal": "payments", "plaid": "payments", "square": "payments", "stripe": "payments",
    "robinhood": "payments", "twelve-data": "finance",
    "alltrails": "travel", "kiwi": "travel", "trivago": "travel", "indeed": "jobs",
    "rentahuman": "other", "strava": "fitness", "unreal-engine": "developer",
}
# Categories whose servers send messages to other people or spend money: the Settings screen flags them.
FLAGGED = {"messaging": "Sends messages to other people", "payments": "Moves money"}

PENDING_TTL_S = 15 * 60
MAX_FLOWS = 8
FINISH_WAIT_S = 90.0
BEGIN_WAIT_S = 30.0
PROBE_TIMEOUT_S = 30.0

# Entry keys a person's or the catalog's server entry may carry (Go whitelists them too); anything else
# is refused here as a second line.
URL_KEYS = {"url", "auth", "oauth", "tools", "enabled", "timeout", "connect_timeout", "sse_read_timeout"}
OAUTH_KEYS = {"client_id", "client_secret", "redirect_host", "redirect_port", "redirect_uri", "scope", "timeout"}
COMMAND_KEYS = {"command", "args", "env", "tools", "enabled", "timeout", "connect_timeout"}


# ---------------------------------------------------------------- catalog

def _entry_of(item: Any) -> dict[str, Any]:
    """The server entry Go stores for a catalog item: its URL, ``auth: oauth`` and the manifest's pinned
    non-secret OAuth block and tool filter. Secret values stay ``${VAR}`` references; Go keeps the
    values itself (``fields``) and fills the references in before the entry reaches a worker."""
    entry: dict[str, Any] = {"url": item.transport.url}
    if item.auth.type == "oauth":
        entry["auth"] = "oauth"
        if item.auth.oauth:
            entry["oauth"] = {k: v for k, v in item.auth.oauth.items() if k in OAUTH_KEYS}
    if item.tools.default_excluded:
        entry["tools"] = {"exclude": list(item.tools.default_excluded)}
    elif item.tools.default_enabled:
        entry["tools"] = {"include": list(item.tools.default_enabled)}
    return entry


def catalog(fields: dict[str, Any], home: Path) -> dict[str, Any]:
    """``{servers: [{id, name, url, category, flag, auth, description, entry, fields, note}]}``, sorted by
    name. ``fields`` are the values the person must give when adding (``[{name, prompt, secret}]``: a
    client id or secret, an instance URL); ``note`` is Hermes' post-install text, shown on the row."""
    from hermes_cli.mcp_catalog import list_catalog

    servers: list[dict[str, Any]] = []
    for item in list_catalog():
        if item.transport.type != "http" or not item.transport.url:
            continue  # the curated catalog is remote-only; a command entry is never offered here
        category = CATEGORY.get(item.name, "other")
        servers.append({
            "id": item.name, "name": item.name, "url": item.transport.url, "category": category,
            "flag": FLAGGED.get(category, ""), "auth": item.auth.type,
            "description": " ".join(item.description.split()),
            "entry": _entry_of(item),
            "fields": [{"name": f.name, "prompt": f.prompt, "secret": bool(f.secret), "required": bool(f.required)}
                       for f in item.auth.env],
            "note": " ".join(item.post_install.split()) if item.post_install else "",
        })
    return {"servers": servers}


# ---------------------------------------------------------------- entries

def _host_allowed(home: Path) -> bool:
    from timely_agent.config_render import account_state
    return account_state(home).get("host_allowed") is True


def _checked_entry(fields: Mapping[str, Any], home: Path) -> tuple[str, dict[str, Any]]:
    """``(name, entry)`` from a request, refused when malformed or a command server for an account that
    is not host-allowed."""
    name = fields.get("name")
    entry = fields.get("entry")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("name is required")
    if not isinstance(entry, Mapping):
        raise ValueError("entry must be an object")
    entry = dict(entry)
    if entry.get("command"):
        if not _host_allowed(home):
            raise ValueError("this account can't use this computer, so it can't start a command server")
        extra = set(entry) - COMMAND_KEYS
        if extra:
            raise ValueError(f"unsupported keys in a command server: {', '.join(sorted(extra))}")
        if not isinstance(entry.get("args", []), list) or not all(isinstance(a, str) for a in entry.get("args", [])):
            raise ValueError("args must be a list of strings")
    elif entry.get("url"):
        extra = set(entry) - URL_KEYS
        if extra:
            raise ValueError(f"unsupported keys in a remote server: {', '.join(sorted(extra))}")
        parts = urlsplit(str(entry["url"]))
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("url must be an http or https address")
        oauth = entry.get("oauth")
        if oauth is not None and not (isinstance(oauth, Mapping) and set(oauth) <= OAUTH_KEYS):
            raise ValueError("unsupported oauth settings")
    else:
        raise ValueError("entry needs a url or a command")
    return name.strip(), entry


@contextlib.contextmanager
def _in_home(home: Path):
    """Point Hermes at the account home for this thread (a context-local override, not ``os.environ``)."""
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    token = set_hermes_home_override(str(home))
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _annotations(tool: Any) -> dict[str, bool]:
    """The tool's declared hints under their wire names (``readOnlyHint``, ...). The SDK model keeps them as
    ``read_only_hint``; only a hint the server actually set (a bool) is reported."""
    ann = getattr(tool, "annotations", None)
    out: dict[str, bool] = {}
    for wire, attr in (("readOnlyHint", "read_only_hint"), ("destructiveHint", "destructive_hint"),
                       ("idempotentHint", "idempotent_hint"), ("openWorldHint", "open_world_hint")):
        value = None
        if ann is not None:
            value = getattr(ann, attr, None)
            if value is None:
                value = getattr(ann, wire, None)
        if isinstance(value, bool):
            out[wire] = value
    return out


def _needs_sign_in(text: str) -> bool:
    low = text.lower()
    return any(w in low for w in ("401", "unauthorized", "oauth", "authoriz", "sign in", "no cached tokens", "login"))


# ---------------------------------------------------------------- probe

def probe(fields: dict[str, Any], home: Path) -> dict[str, Any]:
    """``{tools: [{name, description, annotations}], error?, needs_sign_in}``. A connection failure is an
    answer (``error``), not an exception: the Settings row shows it."""
    name, entry = _checked_entry(fields, home)
    try:
        timeout = min(max(float(fields.get("timeout") or PROBE_TIMEOUT_S), 1.0), 120.0)
    except (TypeError, ValueError):
        timeout = PROBE_TIMEOUT_S
    try:
        tools = _list_tools(name, entry, home, timeout)
    except Exception as exc:  # noqa: BLE001 - the screen shows why
        text = _message(exc)
        return {"tools": [], "error": text[:500], "needs_sign_in": _needs_sign_in(text)}
    return {"tools": tools, "needs_sign_in": False}


def _message(exc: BaseException) -> str:
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return str(exc) or type(exc).__name__


def _list_tools(name: str, entry: dict[str, Any], home: Path, timeout: float) -> list[dict[str, Any]]:
    from tools.mcp_tool_discovery import _connect_server
    from tools.mcp_tool_lifecycle import _stop_mcp_loop_if_idle
    from tools.mcp_tool_loop import _ensure_mcp_loop, _run_on_mcp_loop

    config = dict(entry)
    config["connect_timeout"] = timeout
    found: list[dict[str, Any]] = []

    async def go() -> None:
        server = await asyncio.wait_for(_connect_server(name, config), timeout=timeout)
        try:
            for tool in server._tools:
                found.append({"name": tool.name, "description": " ".join((getattr(tool, "description", "") or "").split())[:300],
                              "annotations": _annotations(tool)})
        finally:
            await server.shutdown()

    with _in_home(home):
        _ensure_mcp_loop()
        try:
            _run_on_mcp_loop(go(), timeout=timeout + 10)
        finally:
            _stop_mcp_loop_if_idle()
    return found


# ---------------------------------------------------------------- OAuth

_flows: dict[str, Any] = {}
_lock = threading.Lock()


def _gc() -> None:
    cutoff = time.time() - PENDING_TTL_S
    with _lock:
        for fid in [fid for fid, f in _flows.items() if f.created_at < cutoff or (f.worker_done and f.status == "error")]:
            flow = _flows.pop(fid)
            flow.mark_error("expired", cancelled=True)


def _put_back(home: Path, backup: dict[str, bytes]) -> None:
    """After a sign-in that did not finish, the files the server had before it began (the old token and
    its client registration) come back. Hermes' own rollback skips this once the attempt registered a
    new client, which would leave the person signed out of a server they were signed in to."""
    from timely_agent.config_render import write_atomic
    from timely_agent.mcp_tokens import token_dir
    for name, data in backup.items():
        try:
            write_atomic(token_dir(home) / name, data, mode=0o600)
        except OSError:
            logger.warning("could not put back %s", name)


def _run_flow(flow: Any, cfg: dict[str, Any], home: Path) -> None:
    """Hermes' dashboard OAuth probe (``hermes_cli.web_server_mcp._run_dashboard_mcp_oauth``) without
    its config write: the sign-in connects the server through the SDK's OAuth provider, which asks the
    flow for the authorization URL and waits for the callback Go delivers."""
    try:
        from tools.mcp_dashboard_oauth import dashboard_oauth_flow
        from tools.mcp_oauth import HermesTokenStorage, force_interactive_oauth, login_connect_timeout
        from tools.mcp_oauth_manager import get_manager

        with _in_home(home), force_interactive_oauth(), dashboard_oauth_flow(flow):
            manager = get_manager()
            storage = HermesTokenStorage(flow.server_name)
            backup = storage.snapshot()
            previous = None
            try:
                previous = manager.remove(flow.server_name, hermes_home=str(home))
                flow.tools = _list_tools(flow.server_name, cfg, home, login_connect_timeout(cfg))
                if not storage.has_cached_tokens():
                    raise RuntimeError("The server answered, but no OAuth token was obtained. "
                                       "It may need an OAuth client registered by hand.")
                flow.mark_approved()
            except Exception:
                _put_back(home, backup)
                manager.restore_entry(flow.server_name, previous, hermes_home=str(home))
                raise
    except Exception as exc:  # noqa: BLE001 - the flow carries the reason to oauth_finish
        message = _message(exc)
        try:
            from tools.mcp_oauth import humanize_oauth_registration_error
            humanized = humanize_oauth_registration_error(flow.server_name, exc, server_url=cfg.get("url"))
            if humanized:
                message = humanized
        except Exception:  # noqa: BLE001 - the plain message will do
            pass
        flow.mark_error(message)
    finally:
        flow.mark_worker_done()


def oauth_begin(fields: dict[str, Any], home: Path) -> dict[str, Any]:
    """Start a sign-in. ``{name, entry, redirect_uri}`` -> ``{authorize_url, state}``. The person opens the
    URL; Timely's callback route receives the redirect and sends ``state`` and ``code`` to ``oauth_finish``."""
    from tools.mcp_dashboard_oauth import DashboardOAuthFlow

    name, entry = _checked_entry(fields, home)
    redirect = fields.get("redirect_uri")
    parts = urlsplit(redirect) if isinstance(redirect, str) else None
    if parts is None or parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("redirect_uri must be an http or https address")
    if not entry.get("url"):
        raise ValueError("only a remote server signs in")
    cfg = dict(entry)
    cfg["auth"] = "oauth"
    cfg["oauth"] = {**(cfg.get("oauth") or {}), "redirect_uri": redirect}
    _gc()
    flow = DashboardOAuthFlow(flow_id=uuid.uuid4().hex, server_name=name, profile=None, hermes_home=str(home),
                              redirect_uri=redirect)
    with _lock:
        for old in [f for f in _flows.values() if f.server_name == name and f.hermes_home == str(home)]:
            old.mark_error("Cancelled: another sign-in started", cancelled=True)  # one sign-in per server
            _flows.pop(old.flow_id, None)
        if sum(1 for f in _flows.values() if not f.worker_done) >= MAX_FLOWS:
            raise ValueError("too many sign-ins are waiting; finish or wait for one")
        _flows[flow.flow_id] = flow
    threading.Thread(target=_run_flow, args=(flow, cfg, home), name=f"timely-mcp-oauth-{name}", daemon=True).start()
    try:
        url = asyncio.run(flow.wait_for_authorization_url(timeout=BEGIN_WAIT_S))
    except Exception as exc:  # noqa: BLE001 - the reason is the flow's if it has one
        flow.mark_error(flow.error or _message(exc), cancelled=True)
        with _lock:
            _flows.pop(flow.flow_id, None)
        raise ValueError(flow.error or _message(exc)) from None
    return {"authorize_url": url, "state": flow.expected_state}


def _find(name: str, state: str, home: Path) -> Any:
    with _lock:
        for flow in _flows.values():
            if flow.server_name == name and flow.hermes_home == str(home) and flow.expected_state == state:
                return flow
    return None


def oauth_finish(fields: dict[str, Any], home: Path) -> dict[str, Any]:
    """Finish a sign-in. ``{name, state, code}`` (or ``{name, state, error}`` when the person said no) ->
    ``{token: {tokens, client_info?, meta?}, tools}``. A state this worker never issued, or already used,
    is refused."""
    name, state = fields.get("name"), fields.get("state")
    if not isinstance(name, str) or not isinstance(state, str) or not state:
        raise ValueError("name and state are required")
    flow = _find(name, state, home)
    if flow is None:
        raise ValueError("This sign-in is not waiting any more. Start it again.")
    error, code = fields.get("error"), fields.get("code")
    try:
        flow.deliver_callback(code=code if isinstance(code, str) and code else None, state=state,
                              error=str(error) if error else None, iss=fields.get("iss") if isinstance(fields.get("iss"), str) else None)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    deadline = time.monotonic() + FINISH_WAIT_S
    while not flow.worker_done and time.monotonic() < deadline:
        time.sleep(0.05)
    with _lock:
        _flows.pop(flow.flow_id, None)
    if flow.status != "approved":
        raise ValueError(flow.error or "The sign-in did not finish. Start it again.")
    from timely_agent import mcp_tokens
    token = mcp_tokens.read_back(home, changed_only=False).get(mcp_tokens.safe_name(name)) or {}
    if not token.get("tokens"):
        raise ValueError("The server answered, but no token was saved. Start the sign-in again.")
    return {"token": token, "tools": list(flow.tools)}

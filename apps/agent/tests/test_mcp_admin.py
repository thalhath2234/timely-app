"""``timely_agent.mcp_admin`` (phase 5, decision 14; PROTOCOL.md section 12.7) on real workers: the catalog,
a tool probe with annotations, and OAuth sign-in, begin to finish. The servers are local fakes
(``tests/fixtures/mcp``): a stdio echo server and an HTTP server with a fake OAuth issuer, both on
127.0.0.1. No real account, nothing is sent (decision 20)."""

from __future__ import annotations

import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

import harness

TESTS = Path(__file__).resolve().parent
FIXTURES = TESTS / "fixtures" / "mcp"
REDIRECT = "https://timely.example.test/agent/mcp/oauth/callback"


class FakeServer:
    """One of the fixture HTTP servers, started the way the tests start workers (venv python, ``-I``)."""

    def __init__(self, *flags: str):
        self.proc = subprocess.Popen([harness.python(), "-I", str(FIXTURES / "oauth_http.py"), *flags],
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.port = 0
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            line = self.proc.stdout.readline()
            if line.startswith("LISTENING"):
                self.port = int(line.split()[1])
                break
            if not line and self.proc.poll() is not None:
                break
        assert self.port, "the fake MCP server did not start"

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/mcp"

    def state(self) -> dict:
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/_state", timeout=10) as r:
            return json.load(r)

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


@pytest.fixture(scope="module")
def open_server():
    s = FakeServer("--open")
    yield s
    s.stop()


@pytest.fixture(scope="module")
def oauth_server():
    s = FakeServer()
    yield s
    s.stop()


@pytest.fixture(scope="module")
def host_agent():
    return harness.Agent(harness.new_root("mcpa"), host=True)


@pytest.fixture(scope="module")
def plain_agent():
    return harness.Agent(harness.new_root("mcpp"))


def _worker(a: harness.Agent) -> harness.Worker:
    # the fake servers listen on loopback, which the MCP address guard (R8) refuses unless told
    w, ready = harness.ready_worker(a, a.argv("--mcp-loopback"))
    assert ready["self_test"]["ok"], ready["self_test"]
    return w


@pytest.fixture(scope="module")
def hw(host_agent):
    w = _worker(host_agent)
    yield w
    w.close()


@pytest.fixture(scope="module")
def pw(plain_agent):
    w = _worker(plain_agent)
    yield w
    w.close()


def ask(w: harness.Worker, a: harness.Agent, mtype: str, timeout: float = 120, **fields) -> dict:
    mid = f"go-{mtype}-{time.monotonic_ns()}"
    w.send({"type": mtype, "id": mid, "account": a.account, **fields})
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        msg = w.recv(max(1.0, deadline - time.monotonic()))
        if msg.get("id") == mid and msg.get("type") in ("mcp.result", "error"):
            return msg
    raise AssertionError(f"no answer to {mtype}")


def data(w, a, mtype, **fields) -> dict:
    res = ask(w, a, mtype, **fields)
    assert res["type"] == "mcp.result" and res["ok"], res
    return res["data"]


def refused(w, a, mtype, **fields) -> str:
    res = ask(w, a, mtype, **fields)
    assert res["type"] == "error" and res["code"] == "bad_message", res
    return res["message"]


STDIO = {"command": harness.python(), "args": ["-I", str(FIXTURES / "echo_stdio.py")]}


# ---------------------------------------------------------------- catalog

def test_the_catalog_lists_every_curated_server_with_an_entry_to_store(hw, host_agent):
    servers = data(hw, host_agent, "mcp.catalog")["servers"]
    names = {s["name"] for s in servers}
    assert len(servers) >= 60 and {"asana", "linear", "intercom", "stripe", "context7"} <= names
    for s in servers:
        assert s["id"] == s["name"] and s["entry"].get("url") and "command" not in s["entry"], s["name"]
        assert s["auth"] in ("oauth", "none") and s["category"] and isinstance(s["fields"], list)
        assert (s["entry"].get("auth") == "oauth") == (s["auth"] == "oauth"), s["name"]
    by = {s["name"]: s for s in servers}
    # Q-5.6: messaging-category servers are in the catalog, flagged
    assert by["intercom"]["category"] == "messaging" and by["intercom"]["flag"]
    assert by["stripe"]["flag"] and not by["linear"]["flag"]
    # a vendor that wants its own OAuth app asks for the values, and the secret stays a reference
    asana = by["asana"]
    assert {f["name"]: f["secret"] for f in asana["fields"]} == {"ASANA_CLIENT_ID": False, "ASANA_CLIENT_SECRET": True}
    assert asana["entry"]["oauth"]["client_secret"] == "${ASANA_CLIENT_SECRET}"
    assert asana["note"] and "\n" not in asana["note"]


# ---------------------------------------------------------------- probe

def test_probe_lists_a_stdio_servers_tools_with_their_annotations(hw, host_agent):
    out = data(hw, host_agent, "mcp.probe", name="echo", entry=STDIO)
    assert out["needs_sign_in"] is False and "error" not in out
    tools = {t["name"]: t for t in out["tools"]}
    assert set(tools) == {"echo", "lookup", "send_message"}
    assert tools["lookup"]["annotations"]["readOnlyHint"] is True
    assert tools["echo"]["annotations"] == {} and tools["echo"]["description"] == "Return the text it was given."


def test_a_command_server_never_starts_for_an_account_that_cannot_use_this_computer(pw, plain_agent):
    assert "can't use this computer" in refused(pw, plain_agent, "mcp.probe", name="echo", entry=STDIO)


def test_probe_reads_annotations_a_remote_server_declares(hw, host_agent, open_server):
    out = data(hw, host_agent, "mcp.probe", name="notes", entry={"url": open_server.url})
    tools = {t["name"]: t["annotations"] for t in out["tools"]}
    assert tools["search_notes"] == {"readOnlyHint": True}
    assert tools["delete_note"]["destructiveHint"] is True
    assert tools["post_status"]["openWorldHint"] is True and tools["post_status"]["readOnlyHint"] is False
    assert tools["send_message"] == {}


def test_a_server_that_wants_a_sign_in_says_so_and_does_not_hang(pw, plain_agent, oauth_server):
    started = time.monotonic()
    out = data(pw, plain_agent, "mcp.probe", name="issuer", entry={"url": oauth_server.url, "auth": "oauth"})
    assert out["tools"] == [] and out["needs_sign_in"] is True and out["error"], out
    assert time.monotonic() - started < 60


def test_an_entry_with_a_key_nobody_listed_is_refused(hw, host_agent):
    assert "unsupported keys" in refused(hw, host_agent, "mcp.probe", name="x",
                                         entry={"url": "https://example.test/mcp", "headers": {"Authorization": "Bearer x"}})
    assert "unsupported keys" in refused(hw, host_agent, "mcp.probe", name="x", entry={**STDIO, "cwd": "/"})
    assert "http or https" in refused(hw, host_agent, "mcp.probe", name="x", entry={"url": "file:///etc/passwd"})
    assert "url or a command" in refused(hw, host_agent, "mcp.probe", name="x", entry={})


# ---------------------------------------------------------------- OAuth

def _authorize(url: str) -> str:
    """What a browser does with the authorization URL: the fake issuer answers with the redirect
    (Location) carrying the code and the state; the test returns it without visiting Timely."""
    class Stop(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    try:
        urllib.request.build_opener(Stop).open(url, timeout=10)
    except urllib.error.HTTPError as e:
        assert e.code == 302
        return e.headers["Location"]
    raise AssertionError("the issuer did not redirect")


def test_oauth_sign_in_begins_at_the_issuer_and_finishes_with_the_token(hw, host_agent, oauth_server):
    a = host_agent
    entry = {"url": oauth_server.url, "auth": "oauth"}
    begun = data(hw, a, "mcp.oauth.begin", name="issuer", entry=entry, redirect_uri=REDIRECT)
    parts = urlsplit(begun["authorize_url"])
    q = parse_qs(parts.query)
    assert parts.hostname == "127.0.0.1" and q["redirect_uri"] == [REDIRECT] and q["state"] == [begun["state"]]
    assert q["code_challenge_method"] == ["S256"]
    # the issuer saw one registration, naming Timely's callback and no loopback listener
    assert oauth_server.state()["registrations"][-1]["redirect_uris"] == [REDIRECT]

    back = _authorize(begun["authorize_url"])
    cb = parse_qs(urlsplit(back).query)
    assert back.startswith(REDIRECT) and cb["state"] == [begun["state"]]

    done = data(hw, a, "mcp.oauth.finish", name="issuer", state=cb["state"][0], code=cb["code"][0])
    token = done["token"]
    assert token["tokens"]["access_token"].startswith("at-") and token["tokens"]["refresh_token"]
    assert token["client_info"]["client_id"].startswith("client-")
    assert {t["name"] for t in done["tools"]} == {"search_notes", "send_message", "delete_note", "post_status"}
    # the issuer minted exactly this token, and the normal token file is where Hermes keeps it
    assert token["tokens"]["access_token"] in oauth_server.state()["tokens"]
    assert (host_agent.home / "mcp-tokens" / "issuer.json").is_file()
    # a probe now needs no sign-in
    out = data(hw, a, "mcp.probe", name="issuer", entry=entry)
    assert out["needs_sign_in"] is False and len(out["tools"]) == 4


def test_a_sign_in_state_works_once(hw, host_agent, oauth_server):
    entry = {"url": oauth_server.url, "auth": "oauth"}
    begun = data(hw, host_agent, "mcp.oauth.begin", name="once", entry=entry, redirect_uri=REDIRECT)
    cb = parse_qs(urlsplit(_authorize(begun["authorize_url"])).query)
    assert "not waiting" in refused(hw, host_agent, "mcp.oauth.finish", name="once", state="made-up", code=cb["code"][0])
    assert "not waiting" in refused(hw, host_agent, "mcp.oauth.finish", name="another", state=begun["state"], code=cb["code"][0])
    assert data(hw, host_agent, "mcp.oauth.finish", name="once", state=begun["state"], code=cb["code"][0])["token"]["tokens"]
    assert "not waiting" in refused(hw, host_agent, "mcp.oauth.finish", name="once", state=begun["state"], code=cb["code"][0])


def test_a_refused_sign_in_ends_with_the_reason_and_keeps_an_earlier_token(hw, host_agent, oauth_server):
    entry = {"url": oauth_server.url, "auth": "oauth"}
    first = data(hw, host_agent, "mcp.oauth.begin", name="keeps", entry=entry, redirect_uri=REDIRECT)
    cb = parse_qs(urlsplit(_authorize(first["authorize_url"])).query)
    good = data(hw, host_agent, "mcp.oauth.finish", name="keeps", state=first["state"], code=cb["code"][0])["token"]
    again = data(hw, host_agent, "mcp.oauth.begin", name="keeps", entry=entry, redirect_uri=REDIRECT)
    msg = refused(hw, host_agent, "mcp.oauth.finish", name="keeps", state=again["state"], error="access_denied")
    assert "access_denied" in msg
    # Hermes' own rollback: the token from before is still on disk
    kept = json.loads((host_agent.home / "mcp-tokens" / "keeps.json").read_text())
    assert kept["access_token"] == good["tokens"]["access_token"]


def test_a_second_begin_for_a_server_cancels_the_first(hw, host_agent, oauth_server):
    entry = {"url": oauth_server.url, "auth": "oauth"}
    one = data(hw, host_agent, "mcp.oauth.begin", name="twice", entry=entry, redirect_uri=REDIRECT)
    two = data(hw, host_agent, "mcp.oauth.begin", name="twice", entry=entry, redirect_uri=REDIRECT)
    assert one["state"] != two["state"]
    cb = parse_qs(urlsplit(_authorize(two["authorize_url"])).query)
    assert "not waiting" in refused(hw, host_agent, "mcp.oauth.finish", name="twice", state=one["state"], code=cb["code"][0])
    assert data(hw, host_agent, "mcp.oauth.finish", name="twice", state=two["state"], code=cb["code"][0])["token"]["tokens"]


def test_begin_needs_a_remote_server_and_an_http_redirect(hw, host_agent, oauth_server):
    assert "only a remote server" in refused(hw, host_agent, "mcp.oauth.begin", name="e", entry=STDIO, redirect_uri=REDIRECT)
    assert "redirect_uri" in refused(hw, host_agent, "mcp.oauth.begin", name="e", entry={"url": oauth_server.url},
                                     redirect_uri="javascript:alert(1)")

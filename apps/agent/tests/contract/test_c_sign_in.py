"""Q-4.1 contract tests (phase 4): no Hermes sign-in is reachable from a Timely worker.

API keys and the CLI providers through Go's loopback gateway only: no ChatGPT/Codex OAuth, no
borrowed Claude Code login, no Nous Portal. The worker refuses a ``run.start`` whose provider is
not one Go's ``hermesProvider`` produces, never reads ``~/.claude/.credentials.json`` (the
managed floor ``auth.adopt_external_logins: false``), and its self-test fails on a Hermes
``auth.json`` in the home or a sign-in provider in the config.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import harness

FAKE_TOKEN = "sk-ant-oat01-FAKE-claude-code-login-for-the-test-0000000000"
FAKE_REFRESH = "sk-ant-ort01-FAKE-refresh-0000000000"


@pytest.fixture(scope="module")
def sagent():
    return harness.Agent(harness.new_root("csi"))


@pytest.fixture(scope="module")
def sworker(sagent):
    w, ready = harness.ready_worker(sagent)
    assert ready["self_test"]["ok"], ready["self_test"]
    assert [c for c in ready["self_test"]["checks"] if c["name"] == "no_sign_in"] == [
        {"name": "no_sign_in", "ok": True, "detail": ""}]
    yield w
    w.close()


def test_c_sign_in_worker_start_never_tries_nous(sagent, sworker):
    """Runtime override R5: the tool registry's vision check at worker start asks Hermes'
    auxiliary resolver for ``provider: "auto"``, whose discovery chain would read the Nous Portal
    credential pool and auth store. With the override nothing tries Nous, so nothing logs it."""
    sworker.send({"type": "ping", "id": "csi-ping", "account": sagent.account})
    sworker.until("pong")
    assert "Nous" not in sworker.stderr and "nous requested" not in sworker.stderr, sworker.stderr[-3000:]


@pytest.mark.parametrize("provider", ["openai-codex", "nous", "copilot", "xai-oauth", "qwen-oauth", ""])
def test_sign_in_providers_are_refused(sagent, sworker, stub, provider):
    msg = harness.run_start(sagent, stub, run_id=f"csi-{provider or 'none'}", conversation="c-csi")
    msg["model"]["provider"] = provider
    sworker.send(msg)
    err, _ = sworker.until("error")
    assert err["code"] == "bad_message" and err["run"] == msg["run"] and err["id"] == msg["id"], err
    assert "provider" in err["message"], err


# Every key Hermes' own classifier sends down its Claude Code OAuth path (Bearer auth, the Claude Code
# identity, the oauth betas on api.anthropic.com): sk-ant-oat, any other sk-ant-* outside the Console
# families, an eyJ JWT and a cc- token.
@pytest.mark.parametrize("key", [
    FAKE_TOKEN, "sk-ant-sid01-FAKE-0000000000", "eyJhbGciOiJIUzI1NiJ9.FAKE.sig", "cc-FAKE0000000000"])
def test_a_claude_code_token_is_not_an_anthropic_key(sagent, sworker, stub, key):
    msg = harness.run_start(sagent, stub, run_id="csi-oat", conversation="c-csi-oat")
    msg["model"].update(provider="anthropic", api_key=key, api_mode="anthropic_messages")
    sworker.send(msg)
    err, _ = sworker.until("error")
    assert err["code"] == "bad_message" and "sign-in token" in err["message"], err


def test_the_claude_code_login_is_never_borrowed(stub):
    """``anthropic`` with an empty key: a Claude Code credentials file in the account's ``HOME``
    and in the real home is never read, so no request ever carries its token."""
    root = harness.new_root("csi-cc")
    a = harness.Agent(root)
    creds = {"claudeAiOauth": {"accessToken": FAKE_TOKEN, "refreshToken": FAKE_REFRESH,
                               "expiresAt": 4102444800000, "scopes": ["user:inference"]}}
    env = a.env()
    for home in (env["HOME"], env["HERMES_REAL_HOME"]):
        target = Path(home) / ".claude" / ".credentials.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(creds), encoding="utf-8")
    w, ready = harness.ready_worker(a)
    try:
        assert ready["self_test"]["ok"], ready["self_test"]
        msg = harness.run_start(a, stub, run_id="csi-cc", conversation="c-csi-cc", text="hello csi-cc")
        msg["model"].update(provider="anthropic", api_key="", api_mode="anthropic_messages",
                            base_url=stub.base_url.removesuffix("/v1"))
        n = len(stub.requests)
        w.send(msg)
        done, _ = harness.drive(w, a.account, "csi-cc")
        assert done["completed"] is False, done
    finally:
        w.close()
    sent = json.dumps(stub.requests[n:])
    assert FAKE_TOKEN not in sent and FAKE_REFRESH not in sent


def test_self_test_fails_on_a_planted_auth_json(stub):
    a = harness.Agent(harness.new_root("csi-auth"))
    (a.home / "auth.json").write_text(json.dumps({"providers": {"nous": {"access_token": "x"}}}), encoding="utf-8")
    w, ready = harness.ready_worker(a)
    try:
        assert ready["self_test"]["ok"] is False
        assert any(f.startswith("no_sign_in: auth.json is in the account home") for f in ready["self_test"]["failures"]), \
            ready["self_test"]["failures"]
        w.send(harness.run_start(a, stub, run_id="csi-auth", conversation="c-csi-auth"))
        err, _ = w.until("error")
        assert err["code"] == "refused", err
    finally:
        w.close()


def test_self_test_fails_on_a_sign_in_provider_in_the_config(stub):
    a = harness.Agent(harness.new_root("csi-cfg"), settings={"model": {"provider": "openai-codex", "default": "gpt"}})
    w, ready = harness.ready_worker(a)
    try:
        assert ready["self_test"]["ok"] is False
        assert any("model.provider is 'openai-codex', a sign-in provider" in f for f in ready["self_test"]["failures"]), \
            ready["self_test"]["failures"]
    finally:
        w.close()

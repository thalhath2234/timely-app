from __future__ import annotations

import json

from timely_agent.run_bot import result_ok


def test_private_address_refusal_is_blocked():
    result = json.dumps({"results": [
        {"url": "http://10.0.0.1/", "error": "Blocked: URL targets a private or internal network address"},
    ]})
    ok, note = result_ok(result)
    assert not ok
    assert note.startswith("Blocked:")


def test_top_level_success_false_is_failed():
    ok, note = result_ok(json.dumps({"success": False, "message": "no provider"}))
    assert not ok
    assert note == "no provider"


def test_private_success_false_gets_blocked_prefix():
    ok, note = result_ok(json.dumps({"success": False, "error": "URL points to a private address"}))
    assert not ok
    assert note.startswith("Blocked: ")


def test_all_items_failing_is_failed():
    result = json.dumps({"results": [{"url": "a", "error": "timeout"}, {"url": "b", "error": "404"}]})
    assert result_ok(result) == (False, "timeout")


def test_partial_success_stays_ok():
    result = json.dumps({"results": [{"url": "a", "error": "timeout"}, {"url": "b", "content": "hi"}]})
    assert result_ok(result) == (True, "")


def test_plain_text_stays_ok():
    assert result_ok("The page says hello") == (True, "")

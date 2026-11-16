"""``bot.done.usage`` carries a tick's tokens under the keys Go's ``botDone.Usage`` reads
(``input_tokens``, ``output_tokens``, ``iterations``; engine_bot.go). No Hermes import: a stub agent
holds the session counters Hermes keeps."""

from __future__ import annotations

import types

from timely_agent import run_bot


def agent_with(**counters):
    return types.SimpleNamespace(**counters)


def test_the_session_counters_reach_the_keys_go_reads():
    agent = agent_with(session_input_tokens=1200, session_output_tokens=80, session_api_calls=3,
                       session_estimated_cost_usd=0.0021)
    usage = run_bot.usage_of(agent, {"model": {"provider": "openrouter", "model": "some/model"}})
    assert usage["input_tokens"] == 1200
    assert usage["output_tokens"] == 80
    assert usage["iterations"] == 3
    assert usage["model"] == "some/model"
    assert usage["estimated_cost_usd"] == 0.0021


def test_a_provider_that_reports_nothing_records_zero_never_a_guess():
    usage = run_bot.usage_of(agent_with(session_api_calls=2), {})
    assert usage["input_tokens"] == 0 and usage["output_tokens"] == 0
    assert usage["iterations"] == 2
    assert usage["estimated_cost_usd"] is None

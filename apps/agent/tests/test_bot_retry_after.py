"""A provider 429's Retry-After reaches ``bot.done.retry_after_seconds`` (PROTOCOL.md 13.2). No Hermes import:
a stub 429 exception goes through the hook the tick puts on its agent."""

from __future__ import annotations

import types
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import pytest

from timely_agent import run_bot


class Stub429(Exception):
    """What an OpenAI-style SDK raises for a 429: ``status_code`` and a ``response`` with headers."""

    status_code = 429

    def __init__(self, headers=None, **attrs):
        super().__init__("Error code: 429 - rate limit exceeded")
        self.response = types.SimpleNamespace(status_code=429, headers=headers if headers is not None else {})
        for key, value in attrs.items():
            setattr(self, key, value)


class FakeAgent:
    """Hermes calls ``agent._extract_api_error_context(error)`` for every API error."""

    def _extract_api_error_context(self, error):
        return {"reason": str(error)}


def seen_by(error):
    """What a tick records after Hermes handled ``error``."""
    agent, trace = FakeAgent(), run_bot.Trace()
    run_bot.watch_retry_after(agent, trace)
    assert agent._extract_api_error_context(error) == {"reason": str(error)}  # Hermes' own result is untouched
    return trace.retry_after


def test_a_429_with_retry_after_seconds_is_recorded_and_sent():
    seconds = seen_by(Stub429({"Retry-After": "120"}))
    assert seconds == 120
    assert run_bot.retry_after_field(run_bot.E_RATE, seconds) == {"retry_after_seconds": 120}


def test_the_header_is_read_in_either_casing():
    assert seen_by(Stub429({"retry-after": "30"})) == 30


def test_a_429_without_a_hint_sends_no_field():
    seconds = seen_by(Stub429())
    assert seconds is None
    assert run_bot.retry_after_field(run_bot.E_RATE, seconds) == {}


@pytest.mark.parametrize("value", ["", "soon", "0", "-5", "nan", "inf"])
def test_unusable_values_are_no_hint(value):
    assert seen_by(Stub429({"Retry-After": value})) is None


def test_an_http_date_is_seconds_from_now():
    when = datetime.now(timezone.utc) + timedelta(minutes=5)
    seconds = seen_by(Stub429({"Retry-After": format_datetime(when, usegmt=True)}))
    assert seconds is not None and 280 < seconds <= 300


def test_an_attribute_or_body_field_counts_when_there_is_no_header():
    assert seen_by(Stub429(retry_after=45)) == 45
    assert seen_by(Stub429(body={"error": {"retry_after": 7}})) == 7
    assert seen_by(Stub429({"Retry-After": "10"}, retry_after=45)) == 10  # the header wins


def test_a_later_error_without_a_hint_clears_an_earlier_one():
    agent, trace = FakeAgent(), run_bot.Trace()
    run_bot.watch_retry_after(agent, trace)
    agent._extract_api_error_context(Stub429({"Retry-After": "60"}))
    assert trace.retry_after == 60
    agent._extract_api_error_context(Stub429())
    assert trace.retry_after is None


def test_the_field_is_only_for_a_rate_limited_tick_and_is_whole_and_bounded():
    assert run_bot.retry_after_field(run_bot.E_ERROR, 120) == {}
    assert run_bot.retry_after_field(run_bot.E_UNREACHABLE, 120) == {}
    assert run_bot.retry_after_field(run_bot.E_RATE, 0.2) == {"retry_after_seconds": 1}
    assert run_bot.retry_after_field(run_bot.E_RATE, 1e12) == {"retry_after_seconds": run_bot.MAX_RETRY_AFTER_S}


def test_an_agent_without_the_hook_is_left_alone():
    agent, trace = object(), run_bot.Trace()
    run_bot.watch_retry_after(agent, trace)
    assert trace.retry_after is None

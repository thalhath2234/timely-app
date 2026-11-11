"""Shared fixtures. Tests import ``timely_agent`` from ``apps/agent`` and start workers through
``boot.py`` with the runtime venv (``make agent-install``); Hermes is only imported inside
worker or helper subprocesses, never into the pytest process."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))
sys.path.insert(0, str(TESTS.parent))

import harness  # noqa: E402
from stub_openai import StubServer  # noqa: E402

FIXTURE_SKILLS = TESTS / "fixtures" / "skills"


@pytest.fixture(scope="session", autouse=True)
def _clean_test_root():
    """Each session's agent folders live in one run folder, removed afterwards (read-only trees
    included). Set TIMELY_AGENT_KEEP=1 to keep them for debugging."""
    yield
    import os
    if os.environ.get("TIMELY_AGENT_KEEP") != "1" and harness.TEST_ROOT.exists():
        from timely_agent.seed import remove_tree
        remove_tree(harness.TEST_ROOT)


@pytest.fixture(scope="session")
def stub():
    srv = StubServer().start()
    yield srv
    srv.shutdown()


@pytest.fixture(scope="module")
def agent():
    """A prepared agent folder (fixture Timely skills and override) with one rendered account."""
    return harness.Agent(harness.new_root("mod"), prepare_opts={"timely_skills_src": str(FIXTURE_SKILLS)})


@pytest.fixture(scope="module")
def worker(agent):
    w, ready = harness.ready_worker(agent)
    w.ready_msg = ready
    yield w
    w.close()


@pytest.fixture(scope="module")
def tagent():
    """An agent folder for a worker that gets the Timely tool specs in hello (phase 2)."""
    return harness.Agent(harness.new_root("tmod"))


@pytest.fixture(scope="module")
def tworker(tagent):
    """A worker with every Timely tool spec from ``fixtures/timely_tools.json`` registered."""
    w, ready = harness.ready_worker(tagent, hello={"timely_tools": harness.timely_tools()})
    assert ready["self_test"]["ok"], ready["self_test"]
    w.ready_msg = ready
    yield w
    w.close()

"""The curator on the worker's maintenance tick (plan 9b.2 item 6, Q-3.6).

Hermes runs its curator only when a host calls ``agent.curator.maybe_run_curator``; the worker
calls it from its maintenance tick while no run is live. Its gates are Hermes': ``curator.enabled``,
not paused, and ``curator.interval_hours`` since the last pass (the first tick only seeds the
clock). The pass marks curator-managed learned skills stale after ``stale_after_days`` unused
days and **never archives**: Hermes has no "no archive" switch, so ``config_render`` sets
``curator.archive_after_days`` to 36,500 days (Hermes' ``apply_automatic_transitions`` archives a
skill only when its last activity is older than that). ``curator.consolidate`` stays false, so no
LLM pass runs. Each skill that turns stale is reported as a ``learning`` event (action ``stale``,
origin ``curator``); ``busy.learning`` is true while the pass runs.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from timely_agent.learning import feed as feed_mod
from timely_agent.learning import files, passes

logger = logging.getLogger("timely_agent.learning")

NEVER_ARCHIVE_DAYS = 36500  # curator.archive_after_days (config_render): about 100 years


def _states(home: Path) -> dict[str, str]:
    return {name: str(rec.get("state") or "active") for name, rec in files.usage(home).items()}


def stale_events(before: dict[str, str], after: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for name, state in sorted(after.items()):
        if state == "stale" and before.get(name) != "stale":
            out.append(feed_mod.make_event(kind="skill", action="stale", subject=name, status="applied",
                                           origin="curator", summary=f"skill '{name}' unused for a while"))
    return out


def tick(home: Optional[Path] = None, *, force: bool = False) -> list[dict[str, Any]]:
    """One maintenance tick: run Hermes' curator when it is due (``force``: a pass now, as
    ``hermes curator run`` would), report stale marks. Never raises."""
    home = Path(home) if home is not None else files.home_dir()
    try:
        from agent.curator import maybe_run_curator, run_curator_review
    except Exception:
        logger.exception("the curator could not be imported")
        return []
    with passes.busy():
        before = _states(home)
        feed = feed_mod.current()
        seen = feed.ledger_ids() if feed is not None else set()
        try:
            if force:
                run_curator_review(synchronous=True, trigger="manual")
            else:
                maybe_run_curator(idle_for_seconds=None)
        except Exception:
            logger.exception("curator pass failed")
        events = stale_events(before, _states(home))
        if feed is not None:
            for ev in events:
                feed.emit(ev)
            # A curator archive (none with Timely's config) is not a chat's change. Only the
            # curator's own entries: a learning pass's write (also actor "curator", but with the
            # chat's session) or a chat's that lands meanwhile still reaches the next diff.
            feed.claim_ledger(since=seen, actors=("curator",),
                              keep=lambda e: not (e.get("evidence") or {}).get("session_id"))
    return events

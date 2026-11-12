"""Learning-review counters per conversation (plan 3.3, 9b.2 item 1).

Hermes fires the skill review when tool-calling iterations since the last ``skill_manage`` reach
``skills.creation_nudge_interval`` (``agent._iters_since_skill``), and the memory review every
``memory.nudge_interval`` user turns (``agent._turns_since_memory``). Both live on the
``AIAgent``. The worker caches one agent per conversation, so they accumulate across turns; this
module keeps them when the agent leaves the cache (LRU eviction, a changed config signature, a
failed run), after every turn and at shutdown, in ``<home>/.timely/counters.json``, and sets them
on the next agent built for that conversation, also in a new worker process after a restart.

Hermes hydrates a fresh agent's memory counter from the transcript on its first turn
(``agent.turn_context._hydrate_from_history``): a counter of 0 becomes ``prior user turns % interval``.
A stored 0 is real (a memory write, or a staged write's reset, set it), so :func:`install` wraps
that hydration and puts the counters :meth:`Counters.apply` set back right after it, before the
turn ticks them; otherwise the memory pass fires early after every restart or agent rebuild.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Optional

from timely_agent.learning import files

FIELDS = (("iters_since_skill", "_iters_since_skill"), ("turns_since_memory", "_turns_since_memory"))
MAX_CONVERSATIONS = 2000
RESTORE_ATTR = "_timely_counters_restore"  # what apply() set, put back after Hermes' first-turn hydration


def install() -> None:
    """Wrap Hermes' first-turn hydration so the stored counters survive it (idempotent; the worker
    calls it once Hermes is imported)."""
    import agent.turn_context as turn_context
    original = turn_context._hydrate_from_history
    if getattr(original, "__timely_counters__", False):
        return

    def hydrate(agent: Any, conversation_history: Any) -> None:
        original(agent, conversation_history)
        restore = getattr(agent, RESTORE_ATTR, None)
        if restore:
            setattr(agent, RESTORE_ATTR, None)
            for attr, value in restore.items():
                setattr(agent, attr, value)

    hydrate.__timely_counters__ = True  # type: ignore[attr-defined]
    turn_context._hydrate_from_history = hydrate


class Counters:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    @classmethod
    def for_home(cls, home: Path) -> "Counters":
        return cls(files.timely_dir(Path(home)) / "counters.json")

    def _load(self) -> dict[str, dict[str, Any]]:
        data = files.read_json(self.path, {})
        convs = data.get("conversations") if isinstance(data, dict) else None
        return {str(k): v for k, v in convs.items() if isinstance(v, dict)} if isinstance(convs, dict) else {}

    def _save(self, convs: dict[str, dict[str, Any]]) -> None:
        if len(convs) > MAX_CONVERSATIONS:
            keep = sorted(convs.items(), key=lambda kv: kv[1].get("updated", 0))[-MAX_CONVERSATIONS:]
            convs = dict(keep)
        files.write_json(self.path, {"version": 1, "conversations": convs})

    def get(self, conversation: str) -> Optional[dict[str, int]]:
        with self._lock:
            row = self._load().get(conversation)
        if row is None:
            return None
        return {key: int(row.get(key) or 0) for key, _ in FIELDS}

    def store(self, conversation: str, agent: Any) -> None:
        """Record the agent's counters for ``conversation`` (never raises)."""
        if not conversation or agent is None:
            return
        try:
            row = {key: max(0, int(getattr(agent, attr, 0) or 0)) for key, attr in FIELDS}
            row["updated"] = time.time()
            with self._lock:
                convs = self._load()
                old = convs.get(conversation) or {}
                if all(old.get(k) == row[k] for k, _ in FIELDS):
                    return
                convs[conversation] = row
                self._save(convs)
        except Exception:
            import logging
            logging.getLogger("timely_agent.learning").exception("storing learning counters failed")

    def apply(self, conversation: str, agent: Any) -> bool:
        """Set the stored counters on a freshly built agent; False when none were stored."""
        row = self.get(conversation)
        if row is None or agent is None:
            return False
        for key, attr in FIELDS:
            setattr(agent, attr, row[key])
        setattr(agent, RESTORE_ATTR, {attr: row[key] for key, attr in FIELDS})
        return True

    def forget(self, conversation: str) -> None:
        with self._lock:
            convs = self._load()
            if convs.pop(conversation, None) is not None:
                self._save(convs)

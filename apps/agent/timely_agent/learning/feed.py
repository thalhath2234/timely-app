"""The learning feed (plan 9b.2 item 4): one ``learning`` message to Go per change.

The worker keeps a baseline of what the account home held: every skill-ledger entry id, the
entries of MEMORY.md and USER.md, and every staged write's id, taken when the worker becomes
ready. ``diff`` compares the home with it, sends one event per change, and moves the baseline,
under one lock. It runs after each run (before ``run.done``) and after each learning pass, so a
change is reported exactly once even when runs of different chats overlap. Writes that Timely's
own code makes (staging in ``timely_learning``, Go's ``learning.*`` requests) report themselves and
claim their ids, so a later diff skips them. A request claims only what it wrote itself (ledger
entries new across the call with its own actor; its own memory delta): a chat's or a learning
pass's write that lands meanwhile still reaches the next diff.

An applied change carries no summary: the apps name it from its kind, action and subject (a
staged one carries a plain one-line summary of what would change).

**Attribution** (Q-3.1: the chip and Undo go under the reply of the chat that learned it). A
ledger entry names the conversation it came from (``evidence.session_id``, set by
``skill_manage``); when that is not the diff's own conversation, the event takes that
conversation's run, origin and taint from its session state (``session_context``), so a skill
another chat's learning pass wrote while this run ended keeps that chat's chip. Memory has no
ledger, so each ``memory`` call that applies reports its own change: ``timely_learning`` calls
:meth:`Feed.begin_memory_write` before it runs and :meth:`Feed.end_memory_write` after, with the
writer's context. While a write is in flight a diff leaves memory alone; a diff reports only
memory changes nobody reported (an older worker's, a write whose hook did not finish).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from timely_agent.learning import files

logger = logging.getLogger("timely_agent.learning")

LEDGER_ACTIONS = {"create": "created", "edit": "edited", "patch": "patched", "write_file": "patched",
                  "remove_file": "patched", "delete": "deleted", "archive": "archived", "restore": "restored"}
SKIPPED_LEDGER_ACTIONS = ("pre-rollback", "rollback")  # Undo; Go's own request reports it
KINDS = ("skill", "memory", "user")
ACTIONS = ("created", "patched", "edited", "deleted", "added", "replaced", "removed", "archived", "restored",
           "stale")
ORIGINS = ("chat", "review", "bot", "user", "curator", "sync", "restore")
STATUSES = ("applied", "staged", "blocked")
# Why a staged change waits (learning.rules): the chat read outside content, a bot wrote it, the
# learning pass would change or remove what memory holds, or the skill-body rule matched.
REASONS = ("", "tainted", "bot", "unattended", "skill_body")


@dataclass
class Context:
    """Where changes found by a diff came from."""
    origin: str = "chat"
    conversation_id: str = ""
    run_id: str = ""
    bot_id: str = ""
    tainted_sources: list = field(default_factory=list)


def make_event(*, kind: str, action: str, subject: str, status: str, origin: str = "chat",
               before: Any = "", after: Any = "", conversation_id: str = "", run_id: str = "", bot_id: str = "",
               tainted_sources: Optional[list] = None, ledger_entry_id: str = "", pending_id: str = "",
               summary: str = "", reason: str = "") -> dict[str, Any]:
    """A ``LearningEventW`` (PROTOCOL.md section 10) with every field present."""
    assert kind in KINDS and action in ACTIONS and status in STATUSES and origin in ORIGINS \
        and reason in REASONS, (kind, action, status, origin, reason)
    return {"id": uuid.uuid4().hex, "kind": kind, "action": action, "subject": str(subject or ""),
            "before": files.cut(before), "after": files.cut(after), "origin": origin,
            "conversation_id": str(conversation_id or ""), "run_id": str(run_id or ""), "bot_id": str(bot_id or ""),
            "tainted_sources": list(tainted_sources or []), "status": status,
            "ledger_entry_id": str(ledger_entry_id or ""), "pending_id": str(pending_id or ""),
            "summary": str(summary or "")[:500], "reason": reason}


def _skill_text(home: Path, items: list[dict], skill: str) -> str:
    """The text of the main file a ledger side touched: SKILL.md when listed, else the first file."""
    items = [i for i in items or [] if isinstance(i, dict)]
    main = next((i for i in items if str(i.get("path", "")).endswith("/SKILL.md")
                 or str(i.get("path", "")).endswith("\\SKILL.md")), None) or (items[0] if items else None)
    if main is None:
        return ""
    return files.read_blob(home, str(main.get("sha256") or "")) or ""


def session_context(session_id: str) -> Optional[Context]:
    """The context of a conversation this worker runs: its latest run, origin and taint."""
    from timely_agent import bridge
    state = bridge.session_state(session_id)
    if state is None:
        return None
    origin = "bot" if state.from_bot or state.kind in ("bot", "bot_review") else "chat"
    return Context(origin=origin, conversation_id=state.session_id, run_id=state.run_id,
                   tainted_sources=state.taint_snapshot())


def ledger_event(home: Path, entry: dict[str, Any], ctx: Context,
                 resolve: Callable[[str], Optional[Context]] = session_context) -> Optional[dict[str, Any]]:
    action = str(entry.get("action") or "")
    if action in SKIPPED_LEDGER_ACTIONS:
        return None
    skill = str(entry.get("skill") or "")
    actor = entry.get("actor")
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    session = str(evidence.get("session_id") or "")
    if session and session != ctx.conversation_id and ctx.origin in ("chat", "review", "bot"):
        try:
            ctx = resolve(session) or ctx
        except Exception:
            logger.exception("finding the conversation of a ledger entry failed")
    origin = "user" if actor == "user" else ("review" if actor == "curator" and ctx.origin == "chat"
                                              else ctx.origin)
    verb = LEDGER_ACTIONS.get(action, "patched")
    return make_event(
        kind="skill", action=verb, subject=skill, status="applied", origin=origin,
        before=_skill_text(home, entry.get("before") or [], skill),
        after=_skill_text(home, entry.get("after") or [], skill),
        conversation_id=str(evidence.get("session_id") or ctx.conversation_id), run_id=ctx.run_id,
        bot_id=ctx.bot_id, tainted_sources=ctx.tainted_sources, ledger_entry_id=str(entry.get("id")))


def memory_events(target: str, old: list[str], new: list[str], ctx: Context,
                  origin: Optional[str] = None) -> list[dict[str, Any]]:
    kind = "user" if target == "user" else "memory"
    removed = [e for e in old if e not in new]
    added = [e for e in new if e not in old]
    out = []
    common = dict(kind=kind, subject=target, status="applied", origin=origin or ctx.origin,
                  conversation_id=ctx.conversation_id, run_id=ctx.run_id, bot_id=ctx.bot_id,
                  tainted_sources=ctx.tainted_sources)
    pairs = min(len(removed), len(added))
    for before, after in zip(removed[:pairs], added[:pairs], strict=True):
        out.append(make_event(action="replaced", before=before, after=after, **common))
    for after in added[pairs:]:
        out.append(make_event(action="added", after=after, **common))
    for before in removed[pairs:]:
        out.append(make_event(action="removed", before=before, **common))
    return out


INFLIGHT_MAX_S = 120.0  # a memory write whose hook never finished stops holding diffs back
BASELINE = "feed-baseline.json"  # under <home>/.timely/: what was last reported (never in a backup)


class Feed:
    """The baseline is also kept on disk (``.timely/feed-baseline.json``), so a worker that stopped
    before reporting (a shutdown during a learning pass, a crash) leaves its changes to the next
    worker: :meth:`catch_up` reports them once ``ready`` is sent. With no saved baseline (the first
    start, a restored home) the current home is the baseline."""

    def __init__(self, home: Path, send: Callable[[dict], Any]):
        self.home = Path(home)
        self.send = send
        self.lock = threading.RLock()
        self._ledger: set[str] = set()
        self._memory: dict[str, list[str]] = {}
        self._pending: set[str] = set()
        self._inflight: dict[str, float] = {}
        self._resumed = self._load()
        if not self._resumed:
            self.prime()

    def _path(self) -> Path:
        return files.timely_dir(self.home) / BASELINE

    def _load(self) -> bool:
        data = files.read_json(self._path(), None)
        if not isinstance(data, dict) or data.get("version") != 1:
            return False
        ledger, memory, pending = data.get("ledger"), data.get("memory"), data.get("pending")
        if not isinstance(ledger, list) or not isinstance(memory, dict) or not isinstance(pending, list):
            return False
        self._ledger = {str(i) for i in ledger}
        self._memory = {t: [str(e) for e in memory.get(t) or [] if isinstance(e, str)] for t in files.MEMORY_FILES}
        self._pending = {str(i) for i in pending}
        return True

    def _save(self) -> None:
        """Keep the baseline on disk (called with the lock held); a failure only costs the catch-up."""
        try:
            files.write_json(self._path(), {"version": 1, "ledger": sorted(self._ledger), "memory": self._memory,
                                            "pending": sorted(self._pending)})
        except Exception:
            logger.exception("saving the learning feed's baseline failed")

    def prime(self) -> None:
        """Take the current home as the baseline (nothing in it is reported)."""
        with self.lock:
            self._ledger = {str(e["id"]) for e in files.read_ledger(self.home)}
            self._memory = {t: files.read_memory(self.home, t) for t in files.MEMORY_FILES}
            self._pending = set(files.pending_ids(self.home))
            self._save()

    def catch_up(self) -> list[dict[str, Any]]:
        """Report what changed since the saved baseline: writes an earlier worker made but stopped
        before reporting (origin ``review``: a learning pass is the only writer that outlives a
        run). Run once, after ``ready``."""
        if not self._resumed:
            return []
        self._resumed = False
        return self.diff(Context(origin="review"))

    # ------------------------------------------------------------ claims (self-reported writes)
    def ledger_ids(self) -> set[str]:
        """The ids the ledger holds now (a request's snapshot before it writes)."""
        return {str(e["id"]) for e in files.read_ledger(self.home)}

    def claim_ledger(self, since: Optional[set[str]] = None, actors: Optional[tuple[str, ...]] = None,
                     keep: Optional[Callable[[dict], bool]] = None) -> list[dict[str, Any]]:
        """Mark ledger entries not seen yet as reported; returns them (oldest first). A request
        that reports its own writes passes ``since`` (the ids before it wrote) and ``actors`` (the
        ledger actor it wrote as), and may narrow further with ``keep``: a chat's or a learning
        pass's entry written meanwhile is left for the next diff, which reports it with its chip
        and Undo. Only the diff itself claims everything."""
        with self.lock:
            new = [e for e in files.read_ledger(self.home) if str(e["id"]) not in self._ledger
                   and (since is None or str(e["id"]) not in since)
                   and (actors is None or e.get("actor") in actors)
                   and (keep is None or keep(e))]
            self._ledger.update(str(e["id"]) for e in new)
            if new:
                self._save()
            return new

    def claim_memory_change(self, target: str, removed: list[str], added: list[str]) -> None:
        """Move the memory baseline by one request's own change only: a chat's write that is on
        disk but not reported yet stays for the next diff (re-reading the file would swallow it)."""
        with self.lock:
            base = [e for e in self._memory.get(target, []) if e not in removed]
            self._memory[target] = base + [e for e in added if e not in base]
            self._save()

    # ------------------------------------------------------------ memory writes (self-reported)
    def begin_memory_write(self, key: str) -> dict[str, list[str]]:
        """A ``memory`` call is about to apply: hold diffs off memory until it reports, and return
        what the files hold now."""
        with self.lock:
            self._inflight[key] = time.monotonic()
            return {t: files.read_memory(self.home, t) for t in files.MEMORY_FILES}

    def end_memory_write(self, key: str, before: Optional[dict[str, list[str]]],
                         ctx: Optional[Context]) -> list[dict[str, Any]]:
        """The call ended: report its own change with the writer's context (only entries the
        baseline does not hold yet) and claim it. ``ctx`` None (blocked, failed) reports nothing."""
        events: list[dict[str, Any]] = []
        with self.lock:
            self._inflight.pop(key, None)
            if before is None or ctx is None:
                return events
            for target in files.MEMORY_FILES:
                after = files.read_memory(self.home, target)
                base = self._memory.get(target, [])
                old = before.get(target, [])
                removed = [e for e in old if e not in after and e in base]
                added = [e for e in after if e not in old and e not in base]
                if not removed and not added:
                    continue
                events += memory_events(target, removed, added, ctx)
                kept = [e for e in base if e not in removed]
                self._memory[target] = kept + [e for e in added if e not in kept]
            if events:
                self._save()
            for ev in events:
                self.emit(ev)
        return events

    def _memory_busy(self) -> bool:
        now = time.monotonic()
        for key, started in list(self._inflight.items()):
            if now - started > INFLIGHT_MAX_S:
                del self._inflight[key]
        return bool(self._inflight)

    def claim_pending(self, pending_id: str) -> None:
        with self.lock:
            self._pending.add(pending_id)
            self._save()

    def forget_pending(self, pending_id: str) -> None:
        with self.lock:
            self._pending.discard(pending_id)
            self._save()

    # ------------------------------------------------------------ sending
    def emit(self, event: dict[str, Any]) -> dict[str, Any]:
        try:
            self.send({"type": "learning", "event": event})
        except Exception:
            logger.exception("sending a learning event failed")
        return event

    def diff(self, ctx: Context) -> list[dict[str, Any]]:
        """Report every change since the baseline; returns the events sent."""
        events: list[dict[str, Any]] = []
        with self.lock:
            for entry in self.claim_ledger():
                ev = ledger_event(self.home, entry, ctx)
                if ev is not None:
                    events.append(ev)
            for target in files.MEMORY_FILES if not self._memory_busy() else ():
                new = files.read_memory(self.home, target)
                old = self._memory.get(target, [])
                if new != old:
                    events += memory_events(target, old, new, ctx)
                    self._memory[target] = new
            for pending_id, subsystem in sorted(files.pending_ids(self.home).items()):
                if pending_id in self._pending:
                    continue
                self._pending.add(pending_id)
                ev = self._pending_event(pending_id, subsystem, ctx)
                if ev is not None:
                    events.append(ev)
            if events:
                self._save()
            for ev in events:
                self.emit(ev)
        return events

    def _pending_event(self, pending_id: str, subsystem: str, ctx: Context) -> Optional[dict[str, Any]]:
        """A write Hermes staged itself (not through timely_learning)."""
        record = files.read_pending(self.home, subsystem, pending_id)
        if record is None:
            return None
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        if subsystem == "memory":
            kind = "user" if payload.get("target") == "user" else "memory"
            subject = payload.get("target") or "memory"
            action = {"add": "added", "remove": "removed"}.get(str(payload.get("action")), "replaced")
        else:
            kind, subject = "skill", payload.get("name") or ""
            action = LEDGER_ACTIONS.get(str(payload.get("action")), "patched")
        return make_event(kind=kind, action=action, subject=subject, status="staged", origin=ctx.origin,
                          after=payload.get("content") or payload.get("new_string") or "",
                          conversation_id=ctx.conversation_id, run_id=ctx.run_id, bot_id=ctx.bot_id,
                          tainted_sources=ctx.tainted_sources, pending_id=pending_id,
                          summary=_plain(subsystem, payload) or str(record.get("summary") or ""))


def _plain(subsystem: str, payload: dict[str, Any]) -> str:
    from timely_agent.learning.staging import plain_summary
    try:
        return plain_summary("skill_manage" if subsystem == "skills" else "memory", payload)
    except Exception:
        return ""


_current: Optional[Feed] = None


def current() -> Optional[Feed]:
    return _current


def install(feed: Optional[Feed]) -> None:
    global _current
    _current = feed

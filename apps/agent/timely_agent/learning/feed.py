"""The learning feed (plan 9b.2 item 4): one ``learning`` message to Go per change.

The worker keeps a baseline of what the account home held: every skill-ledger entry id, the
entries of MEMORY.md and USER.md, and every staged write's id, taken when the worker becomes
ready. ``diff`` compares the home with it, sends one event per change, and moves the baseline,
under one lock. It runs after each run (before ``run.done``) and after each learning pass, so a
change is reported exactly once even when runs of different chats overlap. Writes that Timely's
own code makes (staging in ``timely_learning``, Go's ``learning.*`` requests) report themselves and
claim their ids, so a later diff skips them.

A ledger entry names the conversation it came from (``evidence.session_id``, set by
``skill_manage``); memory has no ledger, so a memory change is attributed to the run whose diff
found it.
"""

from __future__ import annotations

import logging
import threading
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
               summary: str = "") -> dict[str, Any]:
    """A ``LearningEventW`` (PROTOCOL.md section 10) with every field present."""
    assert kind in KINDS and action in ACTIONS and status in STATUSES and origin in ORIGINS, \
        (kind, action, status, origin)
    return {"id": uuid.uuid4().hex, "kind": kind, "action": action, "subject": str(subject or ""),
            "before": files.cut(before), "after": files.cut(after), "origin": origin,
            "conversation_id": str(conversation_id or ""), "run_id": str(run_id or ""), "bot_id": str(bot_id or ""),
            "tainted_sources": list(tainted_sources or []), "status": status,
            "ledger_entry_id": str(ledger_entry_id or ""), "pending_id": str(pending_id or ""),
            "summary": str(summary or "")[:500]}


def _skill_text(home: Path, items: list[dict], skill: str) -> str:
    """The text of the main file a ledger side touched: SKILL.md when listed, else the first file."""
    items = [i for i in items or [] if isinstance(i, dict)]
    main = next((i for i in items if str(i.get("path", "")).endswith("/SKILL.md")
                 or str(i.get("path", "")).endswith("\\SKILL.md")), None) or (items[0] if items else None)
    if main is None:
        return ""
    return files.read_blob(home, str(main.get("sha256") or "")) or ""


def ledger_event(home: Path, entry: dict[str, Any], ctx: Context) -> Optional[dict[str, Any]]:
    action = str(entry.get("action") or "")
    if action in SKIPPED_LEDGER_ACTIONS:
        return None
    skill = str(entry.get("skill") or "")
    actor = entry.get("actor")
    origin = "user" if actor == "user" else ("review" if actor == "curator" and ctx.origin == "chat"
                                              else ctx.origin)
    evidence = entry.get("evidence") if isinstance(entry.get("evidence"), dict) else {}
    verb = LEDGER_ACTIONS.get(action, "patched")
    return make_event(
        kind="skill", action=verb, subject=skill, status="applied", origin=origin,
        before=_skill_text(home, entry.get("before") or [], skill),
        after=_skill_text(home, entry.get("after") or [], skill),
        conversation_id=str(evidence.get("session_id") or ctx.conversation_id), run_id=ctx.run_id,
        bot_id=ctx.bot_id, tainted_sources=ctx.tainted_sources, ledger_entry_id=str(entry.get("id")),
        summary=f"skill '{skill}' {verb}")


def memory_events(target: str, old: list[str], new: list[str], ctx: Context,
                  origin: Optional[str] = None) -> list[dict[str, Any]]:
    kind = "user" if target == "user" else "memory"
    label = "About you" if target == "user" else "notes"
    removed = [e for e in old if e not in new]
    added = [e for e in new if e not in old]
    out = []
    common = dict(kind=kind, subject=target, status="applied", origin=origin or ctx.origin,
                  conversation_id=ctx.conversation_id, run_id=ctx.run_id, bot_id=ctx.bot_id,
                  tainted_sources=ctx.tainted_sources)
    pairs = min(len(removed), len(added))
    for before, after in zip(removed[:pairs], added[:pairs], strict=True):
        out.append(make_event(action="replaced", before=before, after=after, summary=f"{label} changed", **common))
    for after in added[pairs:]:
        out.append(make_event(action="added", after=after, summary=f"{label}: added", **common))
    for before in removed[pairs:]:
        out.append(make_event(action="removed", before=before, summary=f"{label}: removed", **common))
    return out


class Feed:
    def __init__(self, home: Path, send: Callable[[dict], Any]):
        self.home = Path(home)
        self.send = send
        self.lock = threading.RLock()
        self._ledger: set[str] = set()
        self._memory: dict[str, list[str]] = {}
        self._pending: set[str] = set()
        self.prime()

    def prime(self) -> None:
        """Take the current home as the baseline (nothing in it is reported)."""
        with self.lock:
            self._ledger = {str(e["id"]) for e in files.read_ledger(self.home)}
            self._memory = {t: files.read_memory(self.home, t) for t in files.MEMORY_FILES}
            self._pending = set(files.pending_ids(self.home))

    # ------------------------------------------------------------ claims (self-reported writes)
    def claim_ledger(self) -> list[dict[str, Any]]:
        """Mark every ledger entry not seen yet as reported; returns them (oldest first)."""
        with self.lock:
            new = [e for e in files.read_ledger(self.home) if str(e["id"]) not in self._ledger]
            self._ledger.update(str(e["id"]) for e in new)
            return new

    def claim_memory(self, target: Optional[str] = None) -> None:
        with self.lock:
            for t in ([target] if target else list(files.MEMORY_FILES)):
                self._memory[t] = files.read_memory(self.home, t)

    def claim_pending(self, pending_id: str) -> None:
        with self.lock:
            self._pending.add(pending_id)

    def forget_pending(self, pending_id: str) -> None:
        with self.lock:
            self._pending.discard(pending_id)

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
            for target in files.MEMORY_FILES:
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
                          summary=str(record.get("summary") or ""))


_current: Optional[Feed] = None


def current() -> Optional[Feed]:
    return _current


def install(feed: Optional[Feed]) -> None:
    global _current
    _current = feed

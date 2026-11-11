"""Stage a learning write for the person to Keep or Discard (plan 9b.2 item 3, Q-3.1).

Hermes' own store: ``tools.write_approval.stage_write`` writes ``pending/{memory,skills}/<id>.json``
with the exact arguments to replay, and Keep replays them with ``apply_memory_pending`` /
``apply_skill_pending`` (``learning.api``). A memory ``patch``/``remove`` pins the whole entry it
selects now (``tools.memory_tool._pin_matched_entries``), as Hermes does, so Keep changes exactly
the entry the person saw. Timely's context (conversation, run, origin, taint, why it was staged)
goes beside it in ``.timely/pending/<id>.json``.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

from timely_agent.learning import feed as feed_mod
from timely_agent.learning import files

SKILL_KEYS = ("action", "name", "content", "category", "file_path", "file_content", "old_string", "new_string",
              "replace_all", "absorbed_into", "operations")
MEMORY_VERBS = {"add": "added", "remove": "removed", "patch": "replaced", "replace": "replaced", "batch": "replaced"}


class StageError(Exception):
    """The write could not be staged (the message goes to the model, nothing was saved)."""


def skill_payload(args: dict[str, Any]) -> dict[str, Any]:
    payload = {k: args[k] for k in SKILL_KEYS if args.get(k) is not None}
    if isinstance(payload.get("operations"), list):
        payload["action"] = "batch"
    return payload


def memory_payload(args: dict[str, Any]) -> dict[str, Any]:
    target = args.get("target") or "memory"
    ops = args.get("operations")
    if isinstance(ops, list) and ops:
        return {"action": "batch", "target": target, "operations": ops}
    return {"action": args.get("action") or "", "target": target,
            "content": args.get("content") or args.get("new_text"), "old_text": args.get("old_text")}


def _skill_verb(payload: dict[str, Any]) -> str:
    action = payload.get("action")
    if action == "batch":
        ops = [o for o in payload.get("operations") or [] if isinstance(o, dict)]
        return "created" if any(o.get("action") == "create" for o in ops) else "patched"
    return feed_mod.LEDGER_ACTIONS.get(str(action), "patched")


def _skill_subject(payload: dict[str, Any]) -> str:
    if payload.get("name"):
        return str(payload["name"])
    names = [str(o.get("name")) for o in payload.get("operations") or [] if isinstance(o, dict) and o.get("name")]
    return ", ".join(dict.fromkeys(names))


def _after_text(payload: dict[str, Any]) -> str:
    for key in ("content", "new_string", "file_content"):
        if isinstance(payload.get(key), str) and payload[key]:
            return payload[key]
    ops = payload.get("operations") or []
    return "\n\n".join(str(o.get("content") or o.get("new_string") or o.get("file_content") or "")
                       for o in ops if isinstance(o, dict)).strip()


def _skill_file(home: Path, name: str, file_path: str = "") -> str:
    """The skill's current text (SKILL.md, or the support file a patch names), or "" when it is new."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return ""
    rel = Path(file_path) if file_path else Path("SKILL.md")
    if rel.is_absolute() or ".." in rel.parts:
        return ""
    for skill_md in sorted((home / "skills").glob(f"**/{name}/SKILL.md")):
        if ".archive" in skill_md.parts:
            continue
        try:
            return files.cut(skill_md.parent.joinpath(rel).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            return ""
    return ""


def _quote(text: Any, limit: int = 120) -> str:
    text = " ".join(str(text or "").split())
    return f"“{text[:limit - 1]}…”" if len(text) > limit else f"“{text}”"


def plain_summary(tool: str, payload: dict[str, Any]) -> str:
    """One plain line on what a staged write would do, for the Keep / Discard card."""
    action = str(payload.get("action") or "")
    ops = [o for o in payload.get("operations") or [] if isinstance(o, dict)] if action == "batch" else []
    if len(ops) == 1:  # one change sent as a batch reads as that change
        return plain_summary(tool, {**{k: v for k, v in payload.items() if k != "operations"}, **ops[0]})
    if tool == "skill_manage":
        if action == "batch":
            n = len(ops)
            return f"{n} change{'' if n == 1 else 's'} to the skill"
        return {"create": "A new skill", "edit": "Rewrites the skill", "patch": "Changes part of the skill",
                "delete": "Deletes the skill", "remove_file": "Removes a file from the skill",
                "write_file": f"Adds the file {payload.get('file_path') or ''} to the skill".replace("  ", " "),
                }.get(action, "Changes the skill")
    if action == "batch":
        n = len(ops)
        return f"{n} change{'' if n == 1 else 's'}"
    if action == "add":
        return f"Adds {_quote(payload.get('content'))}"
    if action == "remove":
        return f"Removes {_quote(payload.get('matched_entry') or payload.get('old_text'))}"
    return f"Changes it to {_quote(payload.get('content'))}"


def stage(tool: str, args: dict[str, Any], *, origin: str, reason: str, conversation_id: str, run_id: str,
          bot_id: str, tainted_sources: list, home: Optional[Path] = None) -> dict[str, Any]:
    """Stage ``tool``'s write; returns the ``staged`` learning event (already sent). Raises
    :class:`StageError` when the write could not be staged."""
    from tools import write_approval as wa
    home = home or files.home_dir()
    if tool == "skill_manage":
        payload = skill_payload(args)
        if payload.get("action") == "batch":
            ops = payload.get("operations") or []
            summary = f"batch of {len(ops)} change(s) on {_skill_subject(payload)}"
        else:
            summary = wa.skill_gist(str(payload.get("action") or ""), str(payload.get("name") or ""),
                                    content=str(payload.get("content") or ""),
                                    file_path=str(payload.get("file_path") or ""),
                                    old_string=str(payload.get("old_string") or ""),
                                    new_string=str(payload.get("new_string") or ""))
        record = wa.stage_write(wa.SKILLS, payload, summary=summary, origin=origin)
        kind, subject, verb = "skill", _skill_subject(payload), _skill_verb(payload)
        before = "" if payload.get("action") in ("create", "batch") else _skill_file(
            home, str(payload.get("name") or ""), str(payload.get("file_path") or ""))
    else:
        from tools.memory_tool import _pin_matched_entries, load_on_disk_store
        payload = memory_payload(args)
        if payload["action"] not in ("add", "patch", "remove", "batch"):
            raise StageError(f"Unknown memory action {payload['action']!r}. Use: add, patch, remove")
        problem = _pin_matched_entries(load_on_disk_store(), payload)
        if problem is not None:
            try:
                raise StageError(str(json.loads(problem).get("error") or problem))
            except ValueError:
                raise StageError(problem) from None
        label = "user profile" if payload["target"] == "user" else "memory"
        summary = f"{payload['action']} in {label}"
        record = wa.stage_write(wa.MEMORY, payload, summary=summary, origin=origin)
        kind = "user" if payload["target"] == "user" else "memory"
        ops = (payload.get("operations") or []) if payload["action"] == "batch" else [payload]
        one = ops[0] if len(ops) == 1 and isinstance(ops[0], dict) else payload
        subject, verb = payload["target"], MEMORY_VERBS.get(str(one.get("action") or ""), "replaced")
        before = one.get("matched_entry") or one.get("old_text") or ""
    summary = plain_summary(tool, payload)
    pending_id = str(record.get("id") or "")
    if not pending_id or files.read_pending(home, wa.SKILLS if tool == "skill_manage" else wa.MEMORY,
                                            pending_id) is None:
        raise StageError("Timely could not save this for the person to confirm.")
    meta = {"pending_id": pending_id, "tool": tool, "origin": origin, "reason": reason,
            "conversation_id": conversation_id, "run_id": run_id, "bot_id": bot_id,
            "tainted_sources": list(tainted_sources or []), "kind": kind, "subject": subject, "action": verb,
            "summary": summary, "created_at": time.time()}
    files.write_json(files.pending_meta_path(home, pending_id), meta)
    event = feed_mod.make_event(kind=kind, action=verb, subject=subject, status="staged", origin=origin,
                                before=before, after=_after_text(payload), conversation_id=conversation_id,
                                run_id=run_id, bot_id=bot_id, tainted_sources=tainted_sources,
                                pending_id=pending_id, summary=summary,
                                reason=reason if reason in feed_mod.REASONS else "")
    feed = feed_mod.current()
    if feed is not None:
        feed.claim_pending(pending_id)
        feed.emit(event)
    return event


def blocked_event(tool: str, args: dict[str, Any], *, origin: str, message: str, conversation_id: str,
                  run_id: str, bot_id: str, tainted_sources: list) -> Optional[dict[str, Any]]:
    """Report a write the threat scan blocked (status ``blocked``; nothing was saved)."""
    if tool == "skill_manage":
        payload = skill_payload(args)
        kind, subject, verb = "skill", _skill_subject(payload), _skill_verb(payload)
    else:
        payload = memory_payload(args)
        kind = "user" if payload["target"] == "user" else "memory"
        subject, verb = payload["target"], MEMORY_VERBS.get(str(payload["action"]), "added")
    event = feed_mod.make_event(kind=kind, action=verb, subject=subject, status="blocked", origin=origin,
                                after=_after_text(payload), conversation_id=conversation_id, run_id=run_id,
                                bot_id=bot_id, tainted_sources=tainted_sources, summary=message)
    feed = feed_mod.current()
    if feed is not None:
        feed.emit(event)
    return event

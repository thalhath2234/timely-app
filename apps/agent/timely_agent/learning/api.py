"""Go's ``learning.*`` requests and ``settings.update`` (PROTOCOL.md section 10; plan 9b.4).

Each handler takes the request and a :class:`Host` (the worker's home, account and helpers) and
returns the ``data`` of ``learning.result``; :class:`ApiError` becomes an ``error`` reply, and
``Failed`` a ``learning.result`` with ``ok: false``. Everything runs inside the worker after
``ready`` (Hermes imported). Changes the person makes here are reported once: the feed's baseline
claims them, and those with no other answer (an edit, a state change, a memory write) are sent as
``learning`` events with origin ``user``.
"""

from __future__ import annotations

import base64
import difflib
import io
import json
import logging
import threading
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

from timely_agent.learning import feed as feed_mod
from timely_agent.learning import files
from timely_agent.learning import plain

logger = logging.getLogger("timely_agent.learning.api")

EXPORT_MAX_BYTES = 16 * 1024 * 1024
SKILL_STATES = ("lock", "unlock", "archive", "restore", "delete")
MEMORY_ACTIONS = ("add", "replace", "remove")
TYPES = ("learning.list", "learning.skill", "learning.rollback", "learning.edit", "learning.skill_state",
         "learning.memory", "learning.pending", "learning.export", "learning.upstream", "learning.stop",
         "settings.update")


class ApiError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class Failed(Exception):
    """The request was valid but did not succeed (``learning.result`` with ``ok: false``)."""

    def __init__(self, data: dict[str, Any]):
        super().__init__(str(data.get("message") or data))
        self.data = data


@dataclass
class Host:
    home: Path
    account: str
    render: Callable[[dict], str]  # settings -> config_sha256 (re-renders config.yaml in place)
    after_settings: Callable[[], None]  # e.g. drop idle cached agents


def _need_str(msg: dict, key: str) -> str:
    value = msg.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError("bad_message", f"{msg.get('type')} needs {key}")
    return value


def problem(msg: dict[str, Any]) -> Optional[str]:
    """Why a request has the wrong shape, else None (checked before it is handled)."""
    t = msg.get("type")
    try:
        if t == "learning.list":
            if msg.get("what") not in ("skills", "memory", "pending"):
                return "learning.list what must be skills, memory or pending"
        elif t == "learning.skill":
            _need_str(msg, "name")
            if msg.get("entry") is not None and not isinstance(msg.get("entry"), str):
                return "learning.skill entry must be a string"
        elif t == "learning.rollback":
            _need_str(msg, "ledger_entry_id")
        elif t == "learning.edit":
            _need_str(msg, "name")
            _need_str(msg, "content")
        elif t == "learning.skill_state":
            _need_str(msg, "name")
            if msg.get("state") not in SKILL_STATES:
                return f"learning.skill_state state must be one of {list(SKILL_STATES)}"
        elif t == "learning.memory":
            if msg.get("target") not in files.MEMORY_FILES:
                return "learning.memory target must be memory or user"
            if msg.get("action") not in MEMORY_ACTIONS:
                return f"learning.memory action must be one of {list(MEMORY_ACTIONS)}"
            for key in ("content", "old"):
                if msg.get(key) is not None and not isinstance(msg.get(key), str):
                    return f"learning.memory {key} must be a string"
        elif t == "learning.pending":
            _need_str(msg, "pending_id")
            if msg.get("choice") not in ("keep", "discard"):
                return "learning.pending choice must be keep or discard"
        elif t == "learning.upstream":
            if msg.get("action") not in ("list", "compare", "keep_mine", "use_new"):
                return "learning.upstream action must be list, compare, keep_mine or use_new"
        elif t == "settings.update":
            if not isinstance(msg.get("settings"), dict):
                return "settings.update needs a settings object"
        elif t == "learning.export":
            pass
        elif t == "learning.stop":
            if msg.get("conversation_id") is not None and not isinstance(msg.get("conversation_id"), str):
                return "learning.stop conversation_id must be a string"
            if msg.get("search_only") is not None and not isinstance(msg.get("search_only"), bool):
                return "learning.stop search_only must be a boolean"
        else:
            return f"unknown learning request {t!r}"
    except ApiError as exc:
        return exc.message
    return None


def stop(conversation_id: str, search_only: bool = False) -> dict[str, Any]:
    """``learning.stop``: no more memory or skill writes from this conversation's run or learning
    pass (or every conversation's, without an id), and a running pass is cancelled. ADR 0028: a
    chat marked "Don't learn from this chat", or an account with learning off, learns nothing.
    ``search_only`` ("Search my past chats" turned off): only past-chat search stops."""
    from timely_agent import bridge
    if search_only:
        return {"stopped": len(bridge.stop_search(conversation_id))}
    states = bridge.stop_learning(conversation_id)
    for state in states:
        agent = state.agent
        if agent is None:
            continue

        def cancel(agent=agent) -> None:
            try:
                from agent.background_review import cancel_background_review_for_live_turn
                cancel_background_review_for_live_turn(agent, message="learning turned off",
                                                       tool_reason="learning turned off")
            except Exception as exc:  # the writes are blocked whatever happens here
                logger.debug("cancelling a learning pass: %s", exc)
        threading.Thread(target=cancel, name="timely-learning-stop", daemon=True).start()
    return {"stopped": len(states)}


@contextmanager
def _actor(actor: str) -> Iterator[None]:
    from tools.skill_ledger import reset_ledger_actor, set_ledger_actor
    token = set_ledger_actor(actor)
    try:
        yield
    finally:
        reset_ledger_actor(token)


def _feed() -> Optional[feed_mod.Feed]:
    return feed_mod.current()


def _user_ctx() -> feed_mod.Context:
    return feed_mod.Context(origin="user")


def _clear_skill_caches() -> None:
    try:
        from agent.prompt_builder import clear_skills_system_prompt_cache
        clear_skills_system_prompt_cache(clear_snapshot=True)
    except Exception:
        pass


class _Own:
    """What one user request wrote, reported once (see :func:`_user_writes`)."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []


@contextmanager
def _user_writes() -> Iterator[_Own]:
    """Hold the feed while a user request writes, then report (origin ``user``) and claim only the
    ledger entries it wrote: new across the call, with the ``user`` actor. A chat's or a learning
    pass's entry written meanwhile is left for the next diff, with its chip and Undo."""
    feed = _feed()
    own = _Own()
    with (feed.lock if feed is not None else _nolock()):
        seen = feed.ledger_ids() if feed is not None else set()
        yield own
        if feed is not None:
            for entry in feed.claim_ledger(since=seen, actors=("user",)):
                ev = feed_mod.ledger_event(feed.home, entry, _user_ctx())
                if ev is not None:
                    ev["origin"] = "user"
                    own.events.append(feed.emit(ev))


def _memory_delta(before: list[str], after: list[str]) -> tuple[list[str], list[str]]:
    return [e for e in before if e not in after], [e for e in after if e not in before]


# ---------------------------------------------------------------- skills

def _manifest(home: Path) -> dict[str, str]:
    out = {}
    try:
        for line in (home / "skills" / ".bundled_manifest").read_text(encoding="utf-8").splitlines():
            if ":" in line:
                name, digest = line.split(":", 1)
                out[name.strip()] = digest.strip()
    except OSError:
        pass
    return out


def _restored(home: Path) -> set[str]:
    data = files.read_json(files.timely_dir(home) / "restored.json", {})
    names = data.get("skills") if isinstance(data, dict) else data
    return {str(n) if not isinstance(n, dict) else str(n.get("name")) for n in names or []} \
        if isinstance(names, list) else set()


def _disabled() -> set[str]:
    from hermes_cli.config import load_config
    skills = (load_config() or {}).get("skills") or {}
    return {str(s) for s in skills.get("disabled") or []}


def _skill_dir(name: str) -> Optional[Path]:
    from tools.skill_manager_tool import _find_skill
    found = _find_skill(name)
    return Path(found["path"]) if found else None


def _archived_dir(home: Path, name: str) -> Optional[Path]:
    """An archived skill's folder (Hermes flattens ``.archive/<name>``), or None."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    path = home / "skills" / ".archive" / name
    return path if (path / "SKILL.md").is_file() else None


def _archivable(name: str, path: Optional[Path]) -> bool:
    """Whether Archive works for this skill (Hermes refuses shipped and optional ones)."""
    from tools import skill_usage as su
    try:
        return bool(su.is_curation_eligible(name, path))
    except Exception:
        return False


def _is_timely(path: Optional[Path]) -> bool:
    if path is None:
        return False
    from agent.skill_utils import is_external_skill_path
    return bool(is_external_skill_path(path))


DESCRIPTION_CAP = 200  # characters of a skill's description in a list row


def _description(path: Optional[Path]) -> str:
    """The skill's frontmatter ``description``, on one line and clipped (Settings shows it under the
    name, so a person can tell what a built-in skill does before turning it off)."""
    if path is None:
        return ""
    md = path / "SKILL.md" if path.is_dir() else path
    try:
        with open(md, encoding="utf-8", errors="replace") as fh:
            text = fh.read(65536)
        from agent.skill_utils import parse_frontmatter
        meta, _ = parse_frontmatter(text)
    except Exception:
        return ""
    desc = meta.get("description") if isinstance(meta, dict) else None
    if not isinstance(desc, str):
        return ""
    desc = " ".join(desc.split())
    return desc if len(desc) <= DESCRIPTION_CAP else desc[:DESCRIPTION_CAP - 1].rstrip() + "…"


def list_skills(home: Path) -> list[dict[str, Any]]:
    from agent.skill_utils import get_external_skills_dirs
    from tools import skill_usage as su
    from tools.skills_sync import dir_hash
    manifest, restored, disabled = _manifest(home), _restored(home), _disabled()
    created = {}
    for entry in files.read_ledger(home):
        if entry.get("action") == "create":
            created.setdefault(str(entry.get("skill")), str(entry["id"]))
    rows = []
    skills_root = home / "skills"

    def row(name: str, path: Optional[Path], rec: dict, source: str, archived: bool = False) -> dict[str, Any]:
        category = ""
        if path is not None:
            try:
                rel = path.relative_to(skills_root).parts
                category = "/".join(rel[:-1]) if len(rel) > 1 and rel[0] != ".archive" else ""
            except ValueError:
                category = ""
        state = rec.get("state")
        archived = archived or state == "archived"
        return {"name": name, "category": category, "description": _description(path), "source": source,
                "enabled": name not in disabled,
                "locked": bool(rec.get("locked")), "archived": archived,
                "archivable": not archived and source == "learned" and _archivable(name, path),
                "stale": state == "stale", "restored": name in restored,
                "last_used": rec.get("last_used_at") or None, "created_by_event": created.get(name, "")}

    seen = set()
    for rec in su.usage_report():
        name = str(rec.get("name"))
        path = _skill_dir(name)
        prov = rec.get("provenance")
        if name in manifest:
            source = "edited" if path is not None and dir_hash(path) != manifest[name] else "bundled"
        elif prov == "hub":
            source = "optional"
        elif prov == "external":
            source = "timely"
        else:
            source = "learned"
        seen.add(name)
        rows.append(row(name, path, rec, source))
    usage = files.usage(home)
    for name in su.list_archived_skill_names():
        if name not in seen:
            seen.add(name)
            rows.append(row(name, None, usage.get(name, {}), "bundled" if name in manifest else "learned", True))
    for root in get_external_skills_dirs():
        for skill_md in sorted(Path(root).rglob("SKILL.md")):
            name = su.read_skill_name(skill_md, fallback=skill_md.parent.name)
            if name not in seen:
                seen.add(name)
                rows.append(row(name, None, usage.get(name, {}), "timely"))
    return sorted(rows, key=lambda r: (r["source"] not in ("learned", "edited"), r["name"]))


def _history_row(entry: dict[str, Any]) -> dict[str, Any]:
    return {k: entry.get(k) for k in ("id", "ts", "actor", "action", "skill", "evidence")}


def _entry_diff(home: Path, entry: dict[str, Any]) -> str:
    def side(items):
        return {str(i.get("path")): files.read_blob(home, str(i.get("sha256") or "")) or ""
                for i in items or [] if isinstance(i, dict)}
    before, after = side(entry.get("before")), side(entry.get("after"))
    out = []
    for path in sorted(set(before) | set(after)):
        label = Path(path).name
        out += difflib.unified_diff(before.get(path, "").splitlines(keepends=True),
                                    after.get(path, "").splitlines(keepends=True),
                                    fromfile=f"a/{label}", tofile=f"b/{label}")
    return "".join(out)


def skill(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    name = msg["name"]
    path = _skill_dir(name) or _archived_dir(host.home, name)
    if path is None:
        raise ApiError("not_found", plain.NO_SKILL)
    try:
        content = (path / "SKILL.md").read_text(encoding="utf-8")
    except OSError:
        content = ""
    history = [e for e in reversed(files.read_ledger(host.home)) if e.get("skill") == name]
    out: dict[str, Any] = {"name": name, "content": content, "history": [_history_row(e) for e in history]}
    entry_id = msg.get("entry")
    if entry_id:
        entry = next((e for e in history if e.get("id") == entry_id), None)
        if entry is None:
            raise ApiError("not_found", plain.NO_ENTRY)
        out["diff"] = _entry_diff(host.home, entry)
    return out


def _prune_empty_skill_dirs(home: Path, skill: str) -> None:
    """Undoing a learned skill's creation leaves its folder (and maybe its category) empty; remove them."""
    root = home / "skills"
    if not skill or not root.is_dir():
        return
    for path in sorted(root.glob(f"**/{skill}"), key=lambda p: len(p.parts), reverse=True):
        if not path.is_dir() or path.is_symlink() or any(part.startswith(".") for part in path.relative_to(root).parts) \
                or (path / "SKILL.md").exists():
            continue
        for d in sorted((p for p in path.rglob("*") if p.is_dir() and not p.is_symlink()),
                        key=lambda p: len(p.parts), reverse=True) + [path, path.parent]:
            if d == root or root not in d.parents:
                continue
            try:
                d.rmdir()  # only an empty folder goes
            except OSError:
                pass


def _rollback_problem(home: Path, entry: dict[str, Any]) -> str:
    """Why an Undo must not write this entry's before files, else "": a file outside ``skills/``,
    a blob whose content is not its sha256, or text the strict threat scan hits (a ledger that
    came from elsewhere, such as a backup, is not trusted)."""
    import hashlib
    from tools.threat_patterns import scan_for_threats
    skills = (home / "skills").resolve()
    for item in entry.get("before") or []:
        if not isinstance(item, dict):
            return "the history entry is damaged"
        path = Path(str(item.get("path") or ""))
        try:
            inside = path.resolve().is_relative_to(skills)
        except (OSError, RuntimeError):
            inside = False
        if not inside:
            return "it would write outside the skills folder"
        sha = str(item.get("sha256") or "")
        try:
            data = (home / ".curator_backups" / "blobs" / sha).read_bytes() if sha else b""
        except OSError:
            continue  # Hermes refuses a missing blob itself, changing nothing
        if hashlib.sha256(data).hexdigest() != sha:
            return "a saved copy does not match its history entry"
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if scan_for_threats(text, scope="strict"):
            return "the saved copy failed Timely's safety check"
    return ""


def _restored_entries(home: Path) -> set[str]:
    data = files.read_json(files.timely_dir(home) / "restored.json", {})
    ids = data.get("ledger_entries") if isinstance(data, dict) else None
    return {str(i) for i in ids} if isinstance(ids, list) else set()


def _mark_restored(home: Path, name: str) -> None:
    """Add a skill to ``restored.json``'s list (shown "restored, review")."""
    path = files.timely_dir(home) / "restored.json"
    data = files.read_json(path, {})
    data = data if isinstance(data, dict) else {"version": 1}
    names = [n for n in data.get("skills") or [] if isinstance(n, str)]
    if name not in names:
        data["skills"] = sorted(names + [name])
        files.write_json(path, data)


def _superseded(home: Path, entry_id: str, skill: str, own: set[str]) -> list[str]:
    """The ids of the changes to ``skill`` the ledger holds after ``entry_id`` and before this
    rollback's own entries (``own``: the ids written since it started): the rollback writes the
    skill back past them. The ledger's order is the order the changes reached the home, which a
    kept staged change's event time is not."""
    entries = files.read_ledger(home)
    ids = [str(e.get("id")) for e in entries]
    if entry_id not in ids:
        return []
    out = []
    for e in entries[ids.index(entry_id) + 1:]:
        if str(e.get("id")) in own:
            break
        if str(e.get("skill") or "") == skill and str(e.get("action") or "") not in feed_mod.SKIPPED_LEDGER_ACTIONS:
            out.append(str(e.get("id")))
    return out


def rollback(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    """Undo a skill change. An entry a backup restore brought back recreates its skill turned off and
    "restored, review" (``restored_skills`` in the answer; Go keeps it off, Q-3.4).

    ``superseded`` lists the later changes to the same skill the rollback took back too (ledger
    order), for Go to mark undone. Every change no diff reported yet (a learning pass that is
    still running, a run whose diff has not come) is reported first, so its event exists, and
    Go, told its ledger id, never shows it as applied with an Undo that would bring the skill
    back."""
    from tools.skill_ledger import rollback_entry
    entry_id = str(msg["ledger_entry_id"])
    entry = next((e for e in files.read_ledger(host.home) if str(e.get("id")) == entry_id), {})
    problem = _rollback_problem(host.home, entry) if entry else ""
    if problem:
        raise Failed({"ok": False, "message": f"This change cannot be undone: {problem}."})
    skill_name = str(entry.get("skill") or "")
    recreates = any(isinstance(i, dict) and Path(str(i.get("path") or "")).name == "SKILL.md"
                    for i in entry.get("before") or [])
    restored = entry_id in _restored_entries(host.home) and bool(skill_name) and recreates
    feed = _feed()
    superseded: list[str] = []
    # Hermes' skill_manage writes the files first and appends the ledger entry after, both under
    # the skill's mutation lock: holding that lock here, a write already under way finishes (its
    # entry included, so it is reported and named in ``superseded``) and a later one waits. Lock
    # order is feed, then skill, as a user edit takes them (``_user_writes`` around skill_manage).
    with (feed.lock if feed is not None else _nolock()), _skill_lock(skill_name):
        if feed is not None:
            feed.report_ledger(feed_mod.Context(origin="review"))
        seen = feed.ledger_ids() if feed is not None else {str(e.get("id")) for e in files.read_ledger(host.home)}
        with _actor("user"):
            ok, message = rollback_entry(entry_id)
        if ok:
            _prune_empty_skill_dirs(host.home, skill_name)
            if restored:
                _mark_restored(host.home, skill_name)
            own = {str(e.get("id")) for e in files.read_ledger(host.home)
                   if str(e.get("id")) not in seen and e.get("actor") == "user"
                   and str(e.get("action") or "") in feed_mod.SKIPPED_LEDGER_ACTIONS}
            superseded = _superseded(host.home, entry_id, skill_name, own)
        if feed is not None:
            feed.claim_ledger(since=seen, actors=("user",))  # Go marks the event undone itself
            feed.report_ledger(feed_mod.Context(origin="review"))  # a pass's write that landed meanwhile
    _clear_skill_caches()
    if not ok:
        raise Failed({"ok": False, "message": plain.person_facing(message)})
    return {"ok": True, "message": message, "restored_skills": [skill_name] if restored else [],
            "superseded": superseded}


@contextmanager
def _nolock() -> Iterator[None]:
    yield


def _skill_lock(name: str):
    """Hermes' per-skill mutation lock (thread-re-entrant, file based); none for an entry without
    a skill name."""
    if not name:
        return _nolock()
    from tools.skill_manager_tool import _skill_mutation_lock
    return _skill_mutation_lock(name)


def _skill_manage(**kwargs) -> dict[str, Any]:
    from tools.skill_manager_tool import skill_manage
    with _actor("user"):
        raw = skill_manage(**kwargs)
    try:
        result = json.loads(raw)
    except (TypeError, ValueError):
        result = {"success": False, "error": str(raw)}
    return result if isinstance(result, dict) else {"success": False, "error": str(result)}


def edit(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    name = msg["name"]
    path = _skill_dir(name)
    if path is None:
        raise ApiError("not_found", plain.NO_SKILL)
    if _is_timely(path):
        raise Failed({"ok": False, "message": f"{name} is shipped with Timely and is read-only."})
    with _user_writes() as own:
        result = _skill_manage(action="edit", name=name, content=msg["content"])
    if not result.get("success"):
        raise Failed({"ok": False, "message": plain.skill_failure(result.get("error") or result.get("message"))})
    events = own.events
    _clear_skill_caches()
    entries = [e for e in reversed(files.read_ledger(host.home)) if e.get("skill") == name]
    return {"entry": _history_row(entries[0]) if entries else None, "events": events}


RESTORE_FIRST = "This skill is archived. Restore it first."


def skill_state(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    from tools import skill_usage as su
    name, state = msg["name"], msg["state"]
    path = _skill_dir(name)
    archived = _archived_dir(host.home, name) if path is None else None
    if state != "restore" and path is None and archived is None:
        raise ApiError("not_found", plain.NO_SKILL)
    if _is_timely(path):
        raise Failed({"ok": False, "message": f"{name} is shipped with Timely and is read-only."})
    if archived is not None and state in ("lock", "unlock", "archive"):
        raise Failed({"ok": False, "message": RESTORE_FIRST})
    if state in ("archive", "delete") and files.usage(host.home).get(name, {}).get("locked"):
        raise Failed({"ok": False, "message": plain.LOCKED})  # Settings asks to unlock first, as Hermes does for delete
    reset = state == "delete" and archived is None and name in _manifest(host.home)
    with _user_writes() as own:
        if archived is not None and state == "delete":
            ok, message = _delete_archived(name, archived)
        elif reset:
            ok, message = _reset_shipped(name, path)
        elif state in ("lock", "unlock"):
            ok = su.set_locked(name, state == "lock")
            message = f"{name} {state}ed" if ok else f"could not {state} {name}"
        elif state == "archive":
            with _actor("user"):
                ok, message = su.archive_skill(name)
        elif state == "restore":
            with _actor("user"):
                ok, message = su.restore_skill(name)
        else:
            result = _skill_manage(action="delete", name=name)
            ok = bool(result.get("success"))
            message = str(result.get("message") or f"{name} deleted") if ok else \
                str(result.get("error") or result.get("message") or result)
    if not ok:
        raise Failed({"ok": False, "message": plain.skill_failure(message)})
    events = own.events
    _clear_skill_caches()
    rec = files.usage(host.home).get(name, {})
    return {"name": name, "state": state, "message": message, "locked": bool(rec.get("locked")),
            "archived": rec.get("state") == "archived", "reset": reset, "events": events}


def _delete_archived(name: str, path: Path) -> tuple[bool, str]:
    """Delete an archived skill's folder, recorded in the ledger so Undo brings it back."""
    import shutil

    from tools.skill_ledger import capture_before, record_mutation
    before = capture_before(path, complete_package=True, skill=name)
    try:
        shutil.rmtree(path)
    except OSError as exc:
        return False, f"Timely could not delete {name} ({exc.strerror or type(exc).__name__})."
    with _actor("user"):
        record_mutation("delete", name, before=before, before_root=path, actor="user")
    return True, f"{name} deleted"


def _reset_shipped(name: str, path: Optional[Path]) -> tuple[bool, str]:
    """Delete on a shipped skill removes the person's changes: the shipped copy comes back
    (Hermes' sync would never seed a deleted shipped skill again). Recorded as an edit, so Undo
    brings the person's copy back."""
    from tools.skill_ledger import capture_before, record_mutation
    from tools.skills_sync_bundled_ops import reset_bundled_skill
    before = capture_before(path) if path is not None else None
    result = reset_bundled_skill(name, restore=True)
    if not result.get("ok"):
        return False, f"Timely could not bring back the built-in {name}."
    dest = _skill_dir(name)
    with _actor("user"):
        record_mutation("edit", name, before=before, after_root=dest, actor="user", evidence={"reset": "shipped"})
    try:
        from timely_agent import skills_admin
        skills_admin.forget(name)
    except ImportError:
        pass
    return True, f"Your changes to {name} are removed; the built-in skill is back."


# ---------------------------------------------------------------- memory

def _limits() -> dict[str, int]:
    try:
        from hermes_cli.config import load_config
        mem = (load_config() or {}).get("memory") or {}
        return {"memory": int(mem.get("memory_char_limit") or files.MEMORY_LIMITS["memory"]),
                "user": int(mem.get("user_char_limit") or files.MEMORY_LIMITS["user"])}
    except Exception:
        return dict(files.MEMORY_LIMITS)


def _memory_failure_class() -> str:
    """Hermes' class for the memory store's last failure in this context (over_budget, ...)."""
    try:
        from tools.memory_tool_store import FAILURE_CLASS
        return str(FAILURE_CLASS.get())
    except Exception:
        return "other"


def memory_view(home: Path) -> dict[str, Any]:
    limits = _limits()
    out = {}
    for target in files.MEMORY_FILES:
        entries = files.read_memory(home, target)
        out[target] = {"entries": entries, "used": len(files.ENTRY_DELIMITER.join(entries)),
                       "limit": limits[target]}
    return out


def memory(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    from tools.memory_tool import load_on_disk_store
    target, action = msg["target"], msg["action"]
    content, old = str(msg.get("content") or ""), str(msg.get("old") or "")
    if action in ("add", "replace") and not content.strip():
        raise ApiError("bad_message", f"learning.memory {action} needs content")
    if action in ("replace", "remove") and not old.strip():
        raise ApiError("bad_message", f"learning.memory {action} needs old")
    feed = _feed()
    with (feed.lock if feed is not None else _nolock()):
        before = files.read_memory(host.home, target)
        store = load_on_disk_store()
        if action == "add":
            result = store.add(target, content)
        elif action == "replace":
            result = store.replace(target, old, content)
        else:
            result = store.remove(target, old)
        if not isinstance(result, dict) or not result.get("success"):
            failure = _memory_failure_class()
            data = {"ok": False, "message": plain.memory_failure(target, failure)}
            if failure in ("no_match", "stale_entry"):
                data["code"] = "not_found"  # Go: an Undo of a change whose entry is gone is spent
            raise Failed(data)
        after = files.read_memory(host.home, target)
        removed, added = _memory_delta(before, after)
        events = feed_mod.memory_events(target, removed, added, _user_ctx(), origin="user")
        if feed is not None:
            feed.claim_memory_change(target, removed, added)
            for ev in events:
                feed.emit(ev)
    return {**memory_view(host.home)[target], "target": target, "events": events}


# ---------------------------------------------------------------- pending

def _meta(home: Path, pending_id: str) -> dict[str, Any]:
    data = files.read_json(files.pending_meta_path(home, pending_id), {})
    return data if isinstance(data, dict) else {}


def _pending_diff(subsystem: str, record: dict[str, Any]) -> str:
    if subsystem == "skills":
        from tools.write_approval import skill_pending_diff
        payload = record.get("payload") or {}
        if payload.get("action") == "create" and isinstance(payload.get("content"), str):
            # Hermes gives a new skill's raw text; the apps read a unified diff (all lines added)
            name = str(payload.get("name") or "skill")
            return "".join(difflib.unified_diff([], payload["content"].splitlines(keepends=True),
                                                fromfile="/dev/null", tofile=f"{name}/SKILL.md"))
        try:
            return skill_pending_diff(record)
        except Exception as exc:
            return f"(no diff: {type(exc).__name__}: {exc})"
    payload = record.get("payload") or {}
    ops = payload.get("operations") if payload.get("action") == "batch" else [payload]
    lines = []
    for op in ops or []:
        if not isinstance(op, dict):
            continue
        old = op.get("matched_entry") or op.get("old_text")
        if old:
            lines.append(f"- {old}")
        if op.get("action") != "remove" and (op.get("content") or op.get("new_text")):
            lines.append(f"+ {op.get('content') or op.get('new_text')}")
    return "\n".join(lines)


def list_pending(home: Path) -> list[dict[str, Any]]:
    out = []
    for pending_id, subsystem in files.pending_ids(home).items():
        record = files.read_pending(home, subsystem, pending_id)
        if record is None:
            continue
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        meta = _meta(home, pending_id)
        if subsystem == "skills":
            kind = "skill"
            subject = meta.get("subject") or payload.get("name") or ""
        else:
            kind = "user" if payload.get("target") == "user" else "memory"
            subject = payload.get("target") or "memory"
        out.append({"pending_id": pending_id, "kind": meta.get("kind") or kind, "subject": subject,
                    "action": meta.get("action") or str(payload.get("action") or ""),
                    "diff": _pending_diff(subsystem, record),
                    "origin": meta.get("origin") or ("review" if record.get("origin") == "background_review"
                                                     else "chat"),
                    "conversation_id": meta.get("conversation_id") or "",
                    "summary": meta.get("summary") or record.get("summary") or "",
                    "reason": meta.get("reason") if meta.get("reason") in feed_mod.REASONS else "",
                    "tainted_sources": list(meta.get("tainted_sources") or []),
                    "created_at": _rfc3339(record.get("created_at") or meta.get("created_at")),
                    "_t": _seconds(record.get("created_at") or meta.get("created_at"))})
    out.sort(key=lambda r: r["_t"])
    for row in out:
        del row["_t"]
    return out


def _seconds(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _rfc3339(value: Any) -> str:
    """Hermes keeps a pending write's time as epoch seconds; the apps read RFC 3339."""
    seconds = _seconds(value)
    if not seconds:
        return ""
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def pending(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    from tools import write_approval as wa
    pending_id = msg["pending_id"]
    subsystem = files.pending_ids(host.home).get(pending_id)
    if subsystem is None:
        raise ApiError("not_found", plain.NO_PENDING)
    record = files.read_pending(host.home, subsystem, pending_id) or {}
    payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
    meta = _meta(host.home, pending_id)
    meta_path = files.pending_meta_path(host.home, pending_id)
    if msg["choice"] == "discard":
        wa.discard_pending(subsystem, pending_id)
        meta_path.unlink(missing_ok=True)
        return {"discarded": True, "pending_id": pending_id}
    feed = _feed()
    ctx = feed_mod.Context(origin=str(meta.get("origin") or "chat"), conversation_id=str(meta.get("conversation_id") or ""),
                           run_id=str(meta.get("run_id") or ""), bot_id=str(meta.get("bot_id") or ""),
                           tainted_sources=list(meta.get("tainted_sources") or []))
    events: list[dict[str, Any]] = []
    # Hold the feed while the kept change is written, and claim only what it wrote: its ledger
    # entries (new across the call, written as the person) or its target file's own delta.
    with (feed.lock if feed is not None else _nolock()):
        seen = feed.ledger_ids() if feed is not None else set()
        targets = [t for t in files.MEMORY_FILES if t == payload.get("target")] or list(files.MEMORY_FILES)
        before_memory = {t: files.read_memory(host.home, t) for t in targets}
        if subsystem == "skills":
            from tools.skill_manager_tool import apply_skill_pending
            with _actor("user"):
                raw = apply_skill_pending(payload)
            try:
                result = json.loads(raw)
            except (TypeError, ValueError):
                result = {"success": False, "error": str(raw)}
        else:
            from tools.memory_tool import apply_memory_pending, load_on_disk_store
            result = apply_memory_pending(payload, load_on_disk_store())
        if not isinstance(result, dict) or not result.get("success"):
            message = (result or {}).get("error") if isinstance(result, dict) else result
            raise Failed({"ok": False, "message": plain.skill_failure(message) if subsystem == "skills" else
                          plain.memory_failure(str(payload.get("target") or "memory"), _memory_failure_class())})
        wa.discard_pending(subsystem, pending_id)
        meta_path.unlink(missing_ok=True)
        if subsystem == "skills":
            entries = feed.claim_ledger(since=seen, actors=("user",)) if feed is not None else []
            events = [ev for ev in (feed_mod.ledger_event(host.home, e, ctx) for e in entries) if ev is not None]
            for ev in events:
                ev["origin"] = ctx.origin
            _clear_skill_caches()
        else:
            for target in targets:
                removed, added = _memory_delta(before_memory[target], files.read_memory(host.home, target))
                events += feed_mod.memory_events(target, removed, added, ctx)
                if feed is not None:
                    feed.claim_memory_change(target, removed, added)
    for ev in events:
        ev["pending_id"] = pending_id
    return {"pending_id": pending_id, "event": events[-1] if events else None, "events": events}


# ---------------------------------------------------------------- export

def export(home: Path) -> dict[str, Any]:
    """"Download what Timely learned": learned and edited skills (archived ones too, under
    ``skills/.archive/``: Delete of an archived skill tells the person to download first) plus
    ``memories/``."""
    from tools.skills_sync import dir_hash
    manifest = _manifest(home)
    buf = io.BytesIO()
    names: list[str] = []
    total = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in list_skills(home):
            if row["source"] not in ("learned", "edited"):
                continue
            path = _archived_dir(home, row["name"]) if row["archived"] else _skill_dir(row["name"])
            if path is None:
                continue
            if row["name"] in manifest and dir_hash(path) == manifest[row["name"]]:
                continue
            for f in sorted(p for p in path.rglob("*") if p.is_file()):
                rel = Path("skills") / f.relative_to(home / "skills")
                data = f.read_bytes()
                total += len(data)
                if total > EXPORT_MAX_BYTES:
                    raise Failed({"ok": False, "message": "what Timely learned is larger than 16 MB"})
                zf.writestr(rel.as_posix(), data)
                names.append(rel.as_posix())
        for target, fname in files.MEMORY_FILES.items():
            p = files.memory_path(home, target)
            if p.is_file():
                zf.writestr(f"memories/{fname}", p.read_bytes())
                names.append(f"memories/{fname}")
    data = buf.getvalue()
    if len(data) > EXPORT_MAX_BYTES:
        raise Failed({"ok": False, "message": "what Timely learned is larger than 16 MB"})
    return {"zip_b64": base64.b64encode(data).decode("ascii"), "files": names, "size": len(data)}


# ---------------------------------------------------------------- dispatch

def handle(msg: dict[str, Any], host: Host) -> dict[str, Any]:
    """The ``data`` of the answer (raises ApiError / Failed)."""
    bad = problem(msg)
    if bad:
        raise ApiError("bad_message", bad)
    t = msg["type"]
    if t == "learning.list":
        what = msg["what"]
        if what == "skills":
            return {"skills": list_skills(host.home)}
        if what == "memory":
            return memory_view(host.home)
        return {"pending": list_pending(host.home)}
    if t == "learning.skill":
        return skill(msg, host)
    if t == "learning.rollback":
        return rollback(msg, host)
    if t == "learning.edit":
        return edit(msg, host)
    if t == "learning.skill_state":
        return skill_state(msg, host)
    if t == "learning.memory":
        return memory(msg, host)
    if t == "learning.pending":
        return pending(msg, host)
    if t == "learning.export":
        return export(host.home)
    if t == "settings.update":
        sha = host.render(msg["settings"])
        _clear_skill_caches()
        try:
            from agent import skill_utils
            clear = getattr(skill_utils, "_external_dirs_cache_clear", None)
            if callable(clear):
                clear()
        except Exception:
            pass
        host.after_settings()
        return {"config_sha256": sha}
    if t == "learning.stop":
        return stop(str(msg.get("conversation_id") or ""), msg.get("search_only") is True)
    if t == "learning.upstream":
        try:
            from timely_agent import skills_admin  # worker-skills-backup
        except ImportError:
            raise ApiError("unsupported", "learning.upstream is not supported by this worker yet") from None
        result = skills_admin.handle(msg)
        return result if isinstance(result, dict) else {"result": result}
    raise ApiError("unknown_type", f"unknown learning request {t!r}")

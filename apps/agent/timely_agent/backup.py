"""An account's agent state in a backup (plan 6.5, 9b.7; Q-3.4; PROTOCOL.md section 10.8).

Three helpers that ``boot.py`` runs for Go, each printing one JSON object:

- :func:`export_state` (``agent-export``): a zip of what the account learned and talked about.
  Built with Hermes' own walker (``hermes_cli.backup._iter_backup_files``: no symlinks, no caches,
  no SQLite sidecars) and its WAL-safe SQLite copy (``_safe_copy_db``; deleted chats whose
  ``session.delete`` still waits are dropped from the ``state.db`` copy), then narrowed
  to Timely's list: ``memories/``, ``skills/`` minus pristine bundled copies (per
  ``.bundled_manifest``), ``skills/.usage.json``, the skill ledger and ``.curator_backups/blobs``,
  ``pending/``, ``.timely/`` and a ``state.db`` snapshot. Never ``config.yaml``, ``.env*``,
  ``auth.json``, ``mcp-tokens/``, ``SOUL.md``, ``scripts/``, ``hooks/``, ``plugins/``, ``home/``,
  ``workspace/``, checkpoints, browser profiles, caches, logs or runtime files.
- :func:`import_state` (``agent-import``): extracts a zip into ``accounts/.restore-<dir>-<ts>/``
  beside the live home, drops every path the export would never write (a hand-made zip cannot
  plant ``config.yaml`` or ``hooks/``), threat-scans skills (a hit drops the skill and lists it in
  ``blocked``; so does a name Timely could not keep turned off: not a plain name, or one Hermes'
  YAML reads differently, or one of Timely's own skills' names), memory entries, staged writes and the skill ledger's blobs (a blob
  whose content is not its sha256 name, or that the scan hits, is dropped with every ledger entry
  that needs it), keeps only ledger entries whose paths lie under ``skills/`` and rewrites them to
  the account's home, and writes ``.timely/restored.json`` with the restored skills, which Go
  keeps disabled until the person reviews them (Q-3.4), and the restored ledger entry ids (an
  Undo of one brings its skill back disabled and marked the same way).
- :func:`reconcile` (``agent-reconcile``, also run by ``prepare``): a ``.restore-*`` folder that
  holds a ``COMMITTED`` marker (Go writes it after the Postgres restore commits) is swapped in, the
  old home moved to ``.trash`` and then deleted (it held sign-ins and secrets, as Go's
  ``CommitRestore`` deletes it); one without the marker is deleted. A folder staged for another
  agent folder (``instance.json`` ``id``) is never swapped in.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import tempfile
import time
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Optional

from timely_agent import paths, seed

FORMAT = "timely-agent-state"
VERSION = 1
MANIFEST = "timely-agent-state.json"  # the zip's own description: format, version, the old home
COMMITTED = "COMMITTED"
RESTORE_META = "RESTORE.json"
RESTORE_RE = re.compile(r"^\.restore-(account-[0-9a-f]{24})-(\d{8}T\d{6}Z(?:-[0-9a-f]{6})?)$")

# What a zip may hold, by the first path part (``state.db`` is a file at the home's root).
KEEP_TOPS = frozenset({"memories", "skills", "pending", ".timely"})
KEEP_FILES = frozenset({"state.db"})
# Hermes' ``skills/`` metadata folders that are locks or regenerable snapshots.
SKIP_SKILL_TOPS = frozenset({".locks", ".curator_backups"})
BUNDLED_MANIFEST = ".bundled_manifest"
LEDGER = ".curator_ledger.jsonl"
MEMORY_FILES = ("MEMORY.md", "USER.md")
MEMORY_DELIMITER = "\n§\n"  # tools/memory_tool_store.py ENTRY_DELIMITER

# A skill name Go can keep turned off (seed.learned_name_problem, Go's learning.validName); Hermes
# loads a skill by its frontmatter name and matches skills.disabled against it, so any other name
# would come back on.
SKILL_NAME_RE = seed.SKILL_NAME_RE
BLOB_NAME_RE = re.compile(r"^[0-9a-f]{64}$")

MAX_MEMBERS = 200_000
MAX_UNCOMPRESSED = 1024 * 1024 * 1024  # a zip bomb stops here; Go caps the zip itself at 64 MB


class BackupError(Exception):
    pass


# ---------------------------------------------------------------- the never-restore rules

def secret_part(part: str) -> bool:
    """A path part that names a secret: ``.env*``, ``auth.json``, ``mcp-tokens``."""
    return part.startswith(".env") or part in ("auth.json", "mcp-tokens")


def why_never(parts: tuple[str, ...]) -> str:
    """Why a home-relative path is never in a backup, or "" when it may be."""
    if not parts:
        return "empty"
    if any(secret_part(p) for p in parts):
        return "secret"
    top = parts[0]
    if parts == (".timely", "feed-baseline.json"):
        return "not agent state"  # this worker's own bookkeeping (learning/feed.py): a restore primes afresh
    if len(parts) == 1 and top in KEEP_FILES:
        return ""
    if top == ".curator_backups":
        return "" if len(parts) > 2 and parts[1] == "blobs" else "not agent state"
    if top not in KEEP_TOPS or len(parts) == 1:
        return "not agent state"
    if top == "skills" and parts[1] in SKIP_SKILL_TOPS:
        return "not agent state"
    return ""


def _safe_parts(name: str) -> Optional[tuple[str, ...]]:
    """Archive member parts, or None for an absolute, drive or ``..`` path (as Hermes'
    ``hermes_cli.archive_safe.normalize_archive_parts`` decides)."""
    normalized = name.replace("\\", "/")
    p = PurePosixPath(normalized)
    parts = tuple(x for x in p.parts if x not in ("", "."))
    if not normalized or p.is_absolute() or re.match(r"^[A-Za-z]:", normalized) or not parts or ".." in parts:
        return None
    return parts


# ---------------------------------------------------------------- pristine bundled copies

def _manifest(home: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        text = (home / "skills" / BUNDLED_MANIFEST).read_text(encoding="utf-8-sig")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if line:
            name, _, digest = line.partition(":")
            out[name.strip()] = digest.strip()
    return out


def _skill_folders(skills: Path) -> Iterable[Path]:
    for md in sorted(skills.rglob("SKILL.md")):
        rel = md.relative_to(skills).parts
        if rel and rel[0] in SKIP_SKILL_TOPS:
            continue
        yield md.parent


def pristine_bundled(home: Path) -> tuple[set[str], set[str]]:
    """``(folders relative to the home, names)`` of bundled copies still byte-identical to the
    version the manifest seeded: the new home seeds them again from its own seed tree."""
    from tools.skills_sync import _matches_origin_hash
    from tools.skill_usage import read_skill_name
    manifest = _manifest(home)
    folders, names = set(), set()
    skills = home / "skills"
    if not manifest or not skills.is_dir():
        return folders, names
    for d in _skill_folders(skills):
        if d.relative_to(skills).parts[0] == ".archive":
            continue
        name = read_skill_name(d / "SKILL.md", d.name)
        if name in manifest and _matches_origin_hash(d, manifest[name]):
            folders.add(d.relative_to(home).as_posix())
            names.add(name)
    return folders, names


# ---------------------------------------------------------------- export

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def remove_session_files(sessions_dir: Optional[Path], session_id: str) -> None:
    """Remove a chat's files under the home's ``sessions/`` (Hermes' own sweep: ``<id>.json(l)``,
    ``session_<id>.json`` and every ``request_dump_<id>_*.json``, which holds a failed request's
    whole body: the system prompt, every message and tool result). ``delete_session`` runs it only
    for a session row it found, and a run that failed before its first message was saved has a
    dump but no row (review round 8)."""
    from hermes_state import SessionDB
    if sessions_dir is not None and session_id:
        SessionDB._remove_session_files(Path(sessions_dir), session_id)


def _drop_sessions(db: Path, ids: Iterable[str], sessions_dir: Optional[Path] = None) -> list[str]:
    """Delete ``ids`` from a database with Hermes' own ``delete_session`` (what ``session.delete``
    runs for a deleted chat), and their files under ``sessions_dir`` when given, then rewrite the
    file so no deleted page keeps their text. Returns the ids that were there."""
    from hermes_state import SessionDB
    gone: list[str] = []
    sdb = SessionDB(db_path=db)
    try:
        for sid in dict.fromkeys(i for i in ids if isinstance(i, str) and i):
            if sdb.delete_session(sid, sessions_dir=sessions_dir):
                gone.append(sid)
            remove_session_files(sessions_dir, sid)
    finally:
        sdb.close()
    compact_copy(db)
    return gone


def _optimize_fts(conn) -> None:
    """Merge every FTS5 index's segments. A delete from an FTS5 table only adds a delete marker
    and keeps the old segment, a live page that VACUUM keeps, so a deleted chat's words (lower
    case, prefix-compressed) stay in the file until the segments merge (review round 8)."""
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'"
                        " AND lower(sql) LIKE '%using fts5%'").fetchall()
    for (name,) in rows:
        quoted = '"' + str(name).replace('"', '""') + '"'
        conn.execute(f"INSERT INTO {quoted}({quoted}) VALUES('optimize')")
    conn.commit()


def compact_copy(db: Path) -> None:
    """Rewrite a database copy so no page keeps deleted text: a chat deleted earlier (Hermes'
    ``delete_session`` frees its pages without zeroing them, and FTS5 keeps its words until its
    segments merge) must not reach a backup from them."""
    import sqlite3
    conn = sqlite3.connect(db)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode=DELETE")
        _optimize_fts(conn)
        conn.execute("VACUUM")
    finally:
        conn.close()
    for sidecar in ("-wal", "-shm", "-journal"):
        Path(str(db) + sidecar).unlink(missing_ok=True)


def scrub_deleted(db: Path, timeout: float = 10.0) -> bool:
    """After a live ``delete_session``: merge the search index's segments, rewrite ``state.db``
    (VACUUM) and empty its WAL, so the deleted chat's text leaves the home's files, which the
    desktop's folder backup copies raw. Best effort: a busy database is left for the next export,
    which compacts its copy anyway."""
    import sqlite3
    if not db.is_file():
        return False
    try:
        conn = sqlite3.connect(db, timeout=timeout)
        try:
            _optimize_fts(conn)
            conn.execute("VACUUM")
            busy = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return False
    return not busy or busy[0] == 0


def forget_sessions(home: Path, ids: Iterable[str]) -> list[str]:
    """``agent-forget``: what ``session.delete`` does, for chats deleted while the account had no
    worker (Go's waiting ``agent_session_forgets``): delete them from the home's live ``state.db``
    with their ``sessions/`` files, then scrub the file. Returns the ids that were there."""
    ids = [i for i in dict.fromkeys(ids) if isinstance(i, str) and i]
    db, sessions = home / "state.db", home / "sessions"
    gone: list[str] = []
    if db.is_file() and ids:
        from hermes_state import SessionDB
        sdb = SessionDB(db_path=db)
        try:
            gone = [sid for sid in ids if sdb.delete_session(sid, sessions_dir=sessions)]
        finally:
            sdb.close()
        if not scrub_deleted(db):
            raise BackupError("state.db is busy; the deletes are kept for the next try")
    for sid in ids:
        remove_session_files(sessions, sid)
    return gone


def chat_sessions(db: Path) -> list[str]:
    """The chats a ``state.db`` holds: Timely's root sessions (one per conversation id)."""
    import sqlite3
    if not db.is_file():
        return []
    try:
        conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
        try:
            rows = conn.execute("SELECT id FROM sessions WHERE source = 'timely' AND parent_session_id IS NULL "
                                "ORDER BY id").fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return []
    return [str(r[0]) for r in rows if r and r[0]]


def export_state(layout: paths.AgentLayout, account: str, out: Path,
                 drop_sessions: Iterable[str] = ()) -> dict[str, Any]:
    """Write the account's agent state to ``out`` (a zip); see the module docstring.
    ``drop_sessions`` are chats the person deleted whose ``session.delete`` has not reached a worker
    yet (Go's ``agent_session_forgets``): the snapshot leaves them out (review round 6)."""
    from hermes_cli.backup import _iter_backup_files, _write_zip_file
    from hermes_cli.backup_sqlite import _safe_copy_db
    drop = [str(i) for i in drop_sessions if isinstance(i, str) and i]
    home = layout.account_home(account)
    if not home.is_dir():
        raise BackupError(f"the account has no agent home ({home.name})")
    out = Path(out).absolute()
    out.parent.mkdir(parents=True, exist_ok=True)
    pristine, pristine_names = pristine_bundled(home)
    chosen: list[tuple[Path, Path]] = []
    for abs_path, rel in _iter_backup_files(home, out):
        parts = rel.parts
        if why_never(parts):
            continue
        if parts[:2] == ("skills", BUNDLED_MANIFEST):
            continue  # written below without the pristine copies' entries
        posix = rel.as_posix()
        if any(posix == f or posix.startswith(f + "/") for f in pristine):
            continue
        chosen.append((abs_path, rel))
    fd, tmp_name = tempfile.mkstemp(prefix=".agent-export-", suffix=".zip", dir=out.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    files = 0
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for abs_path, rel in chosen:
                if abs_path.suffix == ".db":
                    # A WAL-safe copy staged beside the zip (/tmp may be a small tmpfs), the
                    # deleted chats dropped from state.db, rewritten so no free page keeps a
                    # deleted chat's text (the sqlite backup API copies free pages too), then
                    # zipped.
                    fd, snap_name = tempfile.mkstemp(prefix=".agent-db-", suffix=".db", dir=out.parent)
                    os.close(fd)
                    snap = Path(snap_name)
                    try:
                        if not _safe_copy_db(abs_path, snap):
                            raise BackupError(f"no consistent snapshot of {rel.as_posix()} (database busy?)")
                        if drop and rel.as_posix() == "state.db":
                            _drop_sessions(snap, drop, sessions_dir=home / "sessions")
                        else:
                            compact_copy(snap)
                        _write_zip_file(zf, snap, rel.as_posix())
                    finally:
                        for suffix in ("", "-wal", "-shm", "-journal"):
                            Path(str(snap) + suffix).unlink(missing_ok=True)
                else:
                    _write_zip_file(zf, abs_path, rel.as_posix())
                files += 1
            manifest = {n: h for n, h in _manifest(home).items() if n not in pristine_names}
            if manifest:
                zf.writestr(f"skills/{BUNDLED_MANIFEST}", "".join(f"{n}:{h}\n" for n, h in sorted(manifest.items())))
                files += 1
            zf.writestr(MANIFEST, json.dumps({
                "format": FORMAT, "version": VERSION, "home": str(home), "account_dir": home.name,
                "created_at": datetime.now(UTC).isoformat(), "files": files}, indent=1, sort_keys=True))
        os.replace(tmp, out)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return {"ok": True, "format": FORMAT, "version": VERSION, "sha256": _sha256(out), "size": out.stat().st_size,
            "files": files}


# ---------------------------------------------------------------- import

def _instance_id(layout: paths.AgentLayout) -> str:
    try:
        data = json.loads(layout.instance_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return str(data.get("id") or "") if isinstance(data, dict) else ""


def _threats(text: str) -> list[str]:
    from tools.threat_patterns import scan_for_threats
    return scan_for_threats(text, scope="strict")


def _folder_threats(folder: Path) -> list[str]:
    found: list[str] = []
    for p in sorted(folder.rglob("*")):
        if p.is_file():
            try:
                found += _threats(p.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, OSError):
                continue
    return found


def rewrite_path(path: str, old_home: str, new_home: str) -> Optional[str]:
    """``path`` moved from ``old_home`` to ``new_home``, or None when it is not under the old home
    (then the ``skills/`` part decides, for a zip without the export's own description)."""
    norm = path.replace("\\", "/")
    old = old_home.replace("\\", "/").rstrip("/")
    if old and (norm == old or norm.startswith(old + "/")):
        rest = norm[len(old):].lstrip("/")
    else:
        m = re.search(r"/((?:skills|\.curator_backups)/.*)$", norm)
        if not m:
            return None
        rest = m.group(1)
    return str(Path(new_home).joinpath(*rest.split("/")))


def _rewrite_ledger(ledger: Path, old_home: str, new_home: str, blobs: set[str]) -> tuple[int, int, list[str]]:
    """Rewrite every before/after path of the skill ledger to the new home; returns
    ``(paths rewritten, entries left out, ids kept)``. An entry is left out whole when one of its
    paths cannot be placed under the new home's ``skills/`` (Hermes would refuse it, or an Undo
    would write outside the skills), or a file it would restore has no blob that passed the
    checks (``blobs``): an Undo writes those bytes back."""
    if not ledger.is_file():
        return 0, 0, []
    rewritten = lost = 0
    kept: list[str] = []
    skills = Path(new_home) / "skills"
    lines = []
    for line in ledger.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line) if line.strip() else None
        except ValueError:
            continue
        if not isinstance(row, dict):
            continue
        ok, moved = True, 0
        for side in ("before", "after"):
            items = []
            for item in row.get(side) or []:
                if not isinstance(item, dict):
                    ok = False
                    continue
                new = rewrite_path(str(item.get("path", "")), old_home, new_home)
                if new is None or not Path(new).is_relative_to(skills) or ".." in Path(new).parts:
                    ok = False
                    continue
                if side == "before" and str(item.get("sha256") or "") not in blobs:
                    ok = False
                    continue
                moved += 1
                items.append({**item, "path": new})
            row[side] = items
        if not ok:
            lost += 1
            continue
        rewritten += moved
        kept.append(str(row.get("id") or ""))
        lines.append(json.dumps(row, ensure_ascii=False))
    ledger.write_text("".join(x + "\n" for x in lines), encoding="utf-8")
    return rewritten, lost, [k for k in kept if k]


def _check_blobs(staged: Path, dropped: list[str]) -> set[str]:
    """Keep a ledger blob only when its content hashes to its name and, as text, passes the strict
    threat scan; returns the names kept."""
    root = staged / ".curator_backups" / "blobs"
    kept: set[str] = set()
    if not root.is_dir():
        return kept
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        rel = p.relative_to(staged).as_posix()
        why = ""
        if p.parent != root or not BLOB_NAME_RE.match(p.name):
            why = "not a ledger blob"
        elif _sha256(p) != p.name:
            why = "content does not match its name"
        else:
            try:
                if _threats(p.read_bytes().decode("utf-8")):
                    why = "threat scan"
            except UnicodeDecodeError:
                pass  # a binary file in a skill: nothing for the model to read
        if why:
            p.unlink()
            dropped.append(f"{rel} ({why})")
        else:
            kept.add(p.name)
    return kept


def _timely_skill_names(layout: paths.AgentLayout) -> set[str]:
    """Names of Timely's own skills (prepare's read-only copies). They are reserved, as
    ``timely_learning.external_skill`` reserves them for writes: a restored local skill of that name
    would shadow Timely's, and while it waits for review its name in ``skills.disabled`` would turn
    Timely's own skill off."""
    from tools.skill_usage import read_skill_name
    root = layout.timely_skills_root
    if not root.is_dir():
        return set()
    return {n for md in root.rglob("SKILL.md") for n in (md.parent.name, read_skill_name(md, md.parent.name))}


def _name_problem(skill_md: Path, fallback: str) -> str:
    """Why a restored skill's name could not be kept turned off, else ""."""
    from agent.skill_utils import parse_frontmatter
    from tools.skill_usage import read_skill_name
    name = read_skill_name(skill_md, fallback)
    for candidate in dict.fromkeys((fallback, name)):
        if problem := seed.learned_name_problem(candidate):
            return problem
    try:
        front, _ = parse_frontmatter(skill_md.read_text(encoding="utf-8-sig", errors="replace"))
    except OSError:
        front = {}
    declared = front.get("name") if isinstance(front, dict) else None
    if declared is not None and str(declared).strip() != name:
        return "its name reads differently to Hermes"
    return ""


def _scan_memory(staged: Path, dropped: list[str]) -> None:
    for name in MEMORY_FILES:
        p = staged / "memories" / name
        if not p.is_file():
            continue
        raw = p.read_text(encoding="utf-8-sig", errors="replace")
        entries = [e.strip() for e in raw.split(MEMORY_DELIMITER)]
        kept = []
        for i, e in enumerate(entries):
            if e and _threats(e):
                dropped.append(f"memories/{name} entry {i + 1} (threat scan)")
            elif e:
                kept.append(e)
        if len(kept) != len([e for e in entries if e]):
            p.write_text(MEMORY_DELIMITER.join(kept), encoding="utf-8")


def _scan_pending(staged: Path, dropped: list[str]) -> None:
    root = staged / "pending"
    if not root.is_dir():
        return
    for p in sorted(root.rglob("*.json")):
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            text = ""
        if not text or _threats(text):
            p.unlink()
            dropped.append(p.relative_to(staged).as_posix() + " (threat scan)")


def _check_db(db: Path, dropped: list[str]) -> None:
    if not db.is_file():
        return
    try:
        conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
        try:
            ok = conn.execute("PRAGMA quick_check").fetchone()
        finally:
            conn.close()
        if ok and ok[0] == "ok":
            return
    except sqlite3.Error:
        pass
    db.unlink()
    dropped.append("state.db (not a readable database)")


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + os.urandom(3).hex()


def import_state(layout: paths.AgentLayout, account: str, zip_path: Path) -> dict[str, Any]:
    """Stage a zip as the account's next home; see the module docstring. Nothing touches the
    live home: :func:`reconcile` swaps the staged folder in once Go wrote ``COMMITTED``."""
    from tools.skill_usage import read_skill_name
    layout.accounts_dir.mkdir(parents=True, exist_ok=True)
    final_home = layout.account_home(account)
    try:
        zf = zipfile.ZipFile(zip_path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise BackupError(f"not a zip: {exc}") from None
    with zf:
        try:
            desc = json.loads(zf.read(MANIFEST))
        except (KeyError, ValueError):
            raise BackupError(f"the zip has no {MANIFEST}: not a Timely agent state") from None
        if not isinstance(desc, dict) or desc.get("format") != FORMAT or desc.get("version") != VERSION:
            raise BackupError(f"unsupported agent state (format {desc.get('format')!r}, version {desc.get('version')!r})")
        infos = zf.infolist()
        if len(infos) > MAX_MEMBERS or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
            raise BackupError("the agent state is too large to restore")
        staged = layout.accounts_dir / f".restore-{final_home.name}-{_stamp()}"
        staged.mkdir()
        dropped: list[str] = []
        try:
            for info in infos:
                if info.is_dir() or info.filename == MANIFEST:
                    continue
                parts = _safe_parts(info.filename)
                mode = (info.external_attr >> 16) & 0o170000
                if parts is None:
                    dropped.append(f"{info.filename} (unsafe path)")
                    continue
                if mode and mode != stat.S_IFREG:
                    dropped.append(f"{'/'.join(parts)} (not a regular file)")
                    continue
                why = why_never(parts)
                if why:
                    dropped.append(f"{'/'.join(parts)} ({why})")
                    continue
                dest = staged.joinpath(*parts)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as fh:
                    shutil.copyfileobj(src, fh)
                os.chmod(dest, 0o600)
            # Skills: a strict threat-scan hit drops the whole skill (and its manifest entry, so a
            # bundled one is seeded fresh instead of reading as deleted).
            blocked: list[str] = []
            skills = staged / "skills"
            manifest = _manifest(staged)
            if skills.is_dir():
                reserved = _timely_skill_names(layout)
                for d in list(_skill_folders(skills)):
                    if d.is_dir() and (_folder_threats(d) or _name_problem(d / "SKILL.md", d.name)
                                       or {d.name, read_skill_name(d / "SKILL.md", d.name)} & reserved):
                        name = read_skill_name(d / "SKILL.md", d.name)
                        blocked.append(name)
                        manifest.pop(name, None)
                        shutil.rmtree(d)
                if (skills / BUNDLED_MANIFEST).exists() or manifest:
                    (skills / BUNDLED_MANIFEST).write_text("".join(f"{n}:{h}\n" for n, h in sorted(manifest.items())),
                                                           encoding="utf-8")
            _scan_memory(staged, dropped)
            _scan_pending(staged, dropped)
            _check_db(staged / "state.db", dropped)
            blobs = _check_blobs(staged, dropped)
            rewritten, lost, entries = _rewrite_ledger(skills / LEDGER, str(desc.get("home") or ""), str(final_home),
                                                       blobs)
            if lost:
                dropped.append(f"skills/{LEDGER}: {lost} entr{'y' if lost == 1 else 'ies'} that could not be "
                               "restored safely")
            # Archived skills too (Q-3.4): Restore in Settings would otherwise turn one on unreviewed.
            restored = sorted({read_skill_name(d / "SKILL.md", d.name) for d in _skill_folders(skills)}) \
                if skills.is_dir() else []
            for name in paths.HOME_DIRS:
                (staged / name).mkdir(exist_ok=True)
            timely = staged / ".timely"
            timely.mkdir(exist_ok=True)
            (timely / "restored.json").write_text(json.dumps({
                "version": 1, "restored_at": datetime.now(UTC).isoformat(), "skills": restored,
                "blocked": sorted(blocked), "ledger_entries": entries}, indent=1, sort_keys=True) + "\n",
                encoding="utf-8")
            (staged / RESTORE_META).write_text(json.dumps({
                "account_dir": final_home.name, "instance": _instance_id(layout),
                "staged_at": datetime.now(UTC).isoformat(), "ledger_paths": rewritten}, sort_keys=True) + "\n",
                encoding="utf-8")
        except BaseException:
            shutil.rmtree(staged, ignore_errors=True)
            raise
    # The chats the restored state.db holds: Go deletes those the account no longer has (a chat
    # deleted after this backup was made), as it does for any deleted chat (review round 6).
    return {"ok": True, "staged_dir": str(staged), "restored_skills": restored, "dropped": dropped,
            "blocked": sorted(blocked), "sessions": chat_sessions(staged / "state.db")}


# ---------------------------------------------------------------- reconcile

def reconcile(layout: paths.AgentLayout) -> dict[str, Any]:
    """Finish or drop staged restores (``accounts/.restore-*``); see the module docstring."""
    out: dict[str, Any] = {"ok": True, "swapped": [], "removed": []}
    if not layout.instance_file.is_file():
        raise BackupError(f"{layout.root} has no instance.json; not an agent folder prepare made")
    if not layout.accounts_dir.is_dir():
        return out
    instance = _instance_id(layout)
    for staged in sorted(p for p in layout.accounts_dir.iterdir() if p.name.startswith(".restore-")):
        m = RESTORE_RE.match(staged.name)
        meta: dict[str, Any] = {}
        try:
            meta = json.loads((staged / RESTORE_META).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = {}
        ready = (m is not None and staged.is_dir() and (staged / COMMITTED).is_file()
                 and meta.get("account_dir") == m.group(1) and str(meta.get("instance") or "") == instance)
        if not ready:
            _remove(staged)
            out["removed"].append(staged.name)
            continue
        target = layout.accounts_dir / m.group(1)
        if target.exists():
            layout.trash_dir.mkdir(parents=True, exist_ok=True)
            trashed = layout.trash_dir / f"{target.name}-{m.group(2)}-replaced"
            os.replace(target, trashed)
            try:
                _remove(trashed)  # the old home held sign-ins and secrets: nothing keeps it
            except OSError as exc:
                out.setdefault("warnings", []).append(f"could not delete the replaced home {trashed.name}: {exc}")
        (staged / COMMITTED).unlink()
        (staged / RESTORE_META).unlink()
        os.replace(staged, target)
        out["swapped"].append(target.name)
    return out


def _remove(p: Path) -> None:
    if p.is_dir() and not p.is_symlink():
        def onerror(func, path, _exc):
            os.chmod(path, stat.S_IRWXU)
            func(path)
        shutil.rmtree(p, onerror=onerror)
    else:
        p.unlink(missing_ok=True)


def commit_marker(staged_dir: Path) -> None:
    """What Go writes after the Postgres restore committed (tests use it)."""
    (Path(staged_dir) / COMMITTED).write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n",
                                              encoding="utf-8")

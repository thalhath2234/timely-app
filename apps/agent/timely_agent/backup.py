"""An account's agent state in a backup (plan 6.5, 9b.7; Q-3.4; PROTOCOL.md section 10.8).

Three helpers that ``boot.py`` runs for Go, each printing one JSON object:

- :func:`export_state` (``agent-export``): a zip of what the account learned and talked about.
  Built with Hermes' own walker (``hermes_cli.backup._iter_backup_files``: no symlinks, no caches,
  no SQLite sidecars) and its WAL-safe SQLite snapshot (``_zip_sqlite_snapshot``), then narrowed
  to Timely's list: ``memories/``, ``skills/`` minus pristine bundled copies (per
  ``.bundled_manifest``), ``skills/.usage.json``, the skill ledger and ``.curator_backups/blobs``,
  ``pending/``, ``.timely/`` and a ``state.db`` snapshot. Never ``config.yaml``, ``.env*``,
  ``auth.json``, ``mcp-tokens/``, ``SOUL.md``, ``scripts/``, ``hooks/``, ``plugins/``, ``home/``,
  ``workspace/``, checkpoints, browser profiles, caches, logs or runtime files.
- :func:`import_state` (``agent-import``): extracts a zip into ``accounts/.restore-<dir>-<ts>/``
  beside the live home, drops every path the export would never write (a hand-made zip cannot
  plant ``config.yaml`` or ``hooks/``), threat-scans skills (a hit drops the skill and lists it in
  ``blocked``), memory entries and staged writes, rewrites the skill ledger's absolute paths to
  the account's home and writes ``.timely/restored.json`` with the restored skills, which Go keeps
  disabled until the person reviews them (Q-3.4).
- :func:`reconcile` (``agent-reconcile``, also run by ``prepare``): a ``.restore-*`` folder that
  holds a ``COMMITTED`` marker (Go writes it after the Postgres restore commits) is swapped in, the
  old home going to ``.trash``; one without the marker is deleted. A folder staged for another
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

from timely_agent import paths

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


def export_state(layout: paths.AgentLayout, account: str, out: Path) -> dict[str, Any]:
    """Write the account's agent state to ``out`` (a zip); see the module docstring."""
    from hermes_cli.backup import _iter_backup_files, _write_zip_file, _zip_sqlite_snapshot
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
                    if _zip_sqlite_snapshot(zf, abs_path, rel, out) is None:
                        raise BackupError(f"no consistent snapshot of {rel.as_posix()} (database busy?)")
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


def _rewrite_ledger(ledger: Path, old_home: str, new_home: str) -> tuple[int, int]:
    """Rewrite every before/after path of the skill ledger to the new home; returns
    ``(paths rewritten, paths left out)``. A path that cannot be placed under the new home is
    dropped from its entry (Hermes refuses to roll back an entry naming a path outside the home)."""
    if not ledger.is_file():
        return 0, 0
    rewritten = lost = 0
    lines = []
    for line in ledger.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line) if line.strip() else None
        except ValueError:
            continue
        if not isinstance(row, dict):
            continue
        for side in ("before", "after"):
            items = []
            for item in row.get(side) or []:
                if not isinstance(item, dict):
                    continue
                new = rewrite_path(str(item.get("path", "")), old_home, new_home)
                if new is None:
                    lost += 1
                    continue
                rewritten += 1
                items.append({**item, "path": new})
            row[side] = items
        lines.append(json.dumps(row, ensure_ascii=False))
    ledger.write_text("".join(x + "\n" for x in lines), encoding="utf-8")
    return rewritten, lost


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
                for d in list(_skill_folders(skills)):
                    if d.is_dir() and _folder_threats(d):
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
            rewritten, lost = _rewrite_ledger(skills / LEDGER, str(desc.get("home") or ""), str(final_home))
            if lost:
                dropped.append(f"skills/{LEDGER}: {lost} path(s) outside the old home")
            restored = sorted({read_skill_name(d / "SKILL.md", d.name) for d in _skill_folders(skills)
                               if d.relative_to(skills).parts[0] != ".archive"}) if skills.is_dir() else []
            for name in paths.HOME_DIRS:
                (staged / name).mkdir(exist_ok=True)
            timely = staged / ".timely"
            timely.mkdir(exist_ok=True)
            (timely / "restored.json").write_text(json.dumps({
                "version": 1, "restored_at": datetime.now(UTC).isoformat(), "skills": restored,
                "blocked": sorted(blocked)}, indent=1, sort_keys=True) + "\n", encoding="utf-8")
            (staged / RESTORE_META).write_text(json.dumps({
                "account_dir": final_home.name, "instance": _instance_id(layout),
                "staged_at": datetime.now(UTC).isoformat(), "ledger_paths": rewritten}, sort_keys=True) + "\n",
                encoding="utf-8")
        except BaseException:
            shutil.rmtree(staged, ignore_errors=True)
            raise
    return {"ok": True, "staged_dir": str(staged), "restored_skills": restored, "dropped": dropped,
            "blocked": sorted(blocked)}


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
            os.replace(target, layout.trash_dir / f"{target.name}-{m.group(2)}-replaced")
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

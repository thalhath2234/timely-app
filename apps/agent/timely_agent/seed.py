"""The skill seed tree and the read-only Timely skills copy (plan section 9.1). Stdlib only.

**Seed tree** ``<agent>/seed/<hash>/skills/`` is what ``HERMES_BUNDLED_SKILLS`` points at, so
Hermes' own ``tools.skills_sync.sync_skills()`` seeds every account from it. It holds the
vendored ``hermes/skills/`` tree minus every skill folder whose git tree id is not recorded in
``.hermes-sync/policy/skills-reviewed.json`` (section 9.3), with each
``skills/overrides/<name>/`` replacing the upstream folder of the same name. Without the
reviewed file no upstream skill is seeded (fail closed).

**Timely skills copy** ``<agent>/timely-skills/<hash>/`` is ``apps/agent/skills/`` without
``overrides/``, files ``0444`` and folders ``0555`` (Windows: the read-only attribute). It is
the only ``skills.external_dirs`` entry; the git checkout never is.

Both folders are content-addressed and built once: a second ``prepare`` with the same inputs
reuses them.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Iterable

SKILL_FILE = "SKILL.md"
IGNORED_NAMES = {"__pycache__", ".DS_Store", ".git"}


# ---------------------------------------------------------------- git tree ids

def _blob_id(data: bytes) -> bytes:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).digest()


def _is_executable(path: Path, data: bytes) -> bool:
    if sys.platform == "win32":
        # Windows has no exec bit; every executable file in the copy starts with a shebang.
        return data.startswith(b"#!")
    return os.access(path, os.X_OK)


def git_tree_id(directory: os.PathLike | str) -> str:
    """The git tree id of ``directory`` as committed (``git rev-parse <commit>:<dir>``).

    Files are ``100644`` or ``100755``, folders ``40000``; entries are ordered the way git
    orders them (a folder sorts as ``name/``). Empty folders do not exist in git.
    """
    def tree(d: Path) -> bytes | None:
        entries = []
        for child in d.iterdir():
            if child.name in IGNORED_NAMES:
                continue
            if child.is_symlink():
                target = os.readlink(child).encode("utf-8")
                entries.append((child.name.encode(), b"120000", _blob_id(target)))
            elif child.is_dir():
                sub = tree(child)
                if sub is not None:
                    entries.append((child.name.encode() + b"/", b"40000", sub))
            else:
                data = child.read_bytes()
                mode = b"100755" if _is_executable(child, data) else b"100644"
                entries.append((child.name.encode(), mode, _blob_id(data)))
        if not entries:
            return None
        entries.sort(key=lambda e: e[0])
        body = b"".join(mode + b" " + name.rstrip(b"/") + b"\0" + sha for name, mode, sha in entries)
        return hashlib.sha1(b"tree %d\0" % len(body) + body).digest()

    result = tree(Path(directory))
    return (result or hashlib.sha1(b"tree 0\0").digest()).hex()


def content_hash(paths: Iterable[tuple[str, Path]]) -> str:
    """sha256 over (label, git tree id) pairs; names the content-addressed folders."""
    h = hashlib.sha256()
    for label, path in sorted(paths, key=lambda p: p[0]):
        h.update(label.encode("utf-8") + b"\0" + (git_tree_id(path) if path.exists() else "-").encode() + b"\n")
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- reviewed list

# Hermes never lets these be disabled through ``skills.disabled`` (``agent.skill_utils.ESSENTIAL_SKILLS``;
# the worker self-test checks this copy still matches). A reviewed "default: off" entry for one
# of them therefore keeps it out of the seed tree altogether.
ESSENTIAL_SKILLS = frozenset({"hermes-agent"})


def load_reviewed(path: os.PathLike | str) -> dict[str, dict] | None:
    """``{"skills/<cat>/<name>": {"tree": id, "default": "on"|"off", ...}}`` from
    skills-reviewed.json, or None when absent.

    Accepts ``{path: id}`` or ``{path: {"tree": id, ...}}``, optionally under ``"skills"``
    (the convention ``scripts/hermes-sync/report.py`` reads). A bare id means default on.
    """
    p = Path(path)
    if not p.is_file():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("skills"), dict):
        data = data["skills"]
    out: dict[str, dict] = {}
    for key, value in (data or {}).items():
        entry = dict(value) if isinstance(value, dict) else {"tree": value}
        if isinstance(entry.get("tree"), str):
            out[key] = entry
    return out


def skill_names(skill_dir: Path) -> set[str]:
    """The folder name and the frontmatter ``name:`` (what ``skills.disabled`` may list)."""
    names = {skill_dir.name}
    try:
        text = (skill_dir / SKILL_FILE).read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return names
    if text.startswith("---"):
        end = text.find("\n---", 3)
        for line in text[3:end if end > 0 else len(text)].splitlines():
            if line.startswith("name:"):
                value = line[5:].strip().strip("'\"")
                if value:
                    names.add(value)
                break
    return names


def skill_dirs(root: Path) -> list[Path]:
    """Folders under ``root`` that hold a SKILL.md (a skill folder is never nested in another)."""
    found = []
    for skill_md in sorted(root.rglob(SKILL_FILE)):
        if any(part in IGNORED_NAMES for part in skill_md.parts):
            continue
        found.append(skill_md.parent)
    return found


# ---------------------------------------------------------------- read-only trees

def _make_read_only(root: Path) -> None:
    for dirpath, _dirnames, filenames in os.walk(root, topdown=False):
        for name in filenames:
            p = Path(dirpath, name)
            os.chmod(p, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        os.chmod(dirpath, stat.S_IRUSR | stat.S_IXUSR | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)


def _make_writable(root: Path) -> None:
    for dirpath, _dirnames, filenames in os.walk(root):
        os.chmod(dirpath, stat.S_IRWXU)
        for name in filenames:
            os.chmod(Path(dirpath, name), stat.S_IRUSR | stat.S_IWUSR)


def remove_tree(root: Path) -> None:
    if root.exists():
        _make_writable(root)
        shutil.rmtree(root)


def _publish(staging: Path, final: Path) -> None:
    """Move a finished staging folder into place; a concurrent builder that won keeps its copy."""
    try:
        os.replace(staging, final)
    except OSError:
        if final.exists():
            remove_tree(staging)
        else:
            raise


def _copy_tree(src: Path, dst: Path, *, skip_top: set[str] = frozenset()) -> None:
    def ignore(directory: str, names: list[str]) -> set[str]:
        skip = {n for n in names if n in IGNORED_NAMES}
        if Path(directory) == src:
            skip |= {n for n in names if n in skip_top}
        return skip
    shutil.copytree(src, dst, ignore=ignore, symlinks=False, dirs_exist_ok=True)


def build_timely_skills(layout, src: os.PathLike | str) -> Path:
    """The read-only copy of Timely's own skills; returns ``<agent>/timely-skills/<hash>``.

    A missing source folder yields an empty (still read-only) copy, so the external dir
    always exists and the canary can check it.
    """
    src = Path(src)
    digest = content_hash([(p.name, p) for p in sorted(src.iterdir()) if p.name != "overrides"
                           and p.name not in IGNORED_NAMES]) if src.is_dir() else "empty"
    final = layout.timely_skills_root / digest
    if final.is_dir():
        return final
    layout.timely_skills_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".build-", dir=layout.timely_skills_root))
    if src.is_dir():
        _copy_tree(src, staging, skip_top={"overrides"})
    _make_read_only(staging)
    _publish(staging, final)
    return final


def build_seed_tree(layout, *, upstream: os.PathLike | str, overrides: os.PathLike | str | None,
                    reviewed: dict[str, dict] | None, upstream_prefix: str = "skills") -> tuple[Path, dict]:
    """Build (or reuse) the seed tree; returns ``(<seed>/<hash>/skills, report)``.

    ``reviewed`` comes from :func:`load_reviewed`; ``None`` seeds no upstream skill. The report
    lists seeded, unreviewed (no entry or a changed tree), overridden and essential-off skills,
    and ``default_off``: the names of seeded skills whose entry says ``default: off``, which
    the account config puts in ``skills.disabled``.
    """
    upstream = Path(upstream)
    overrides_dir = Path(overrides) if overrides else None
    override_dirs = {p.name: p for p in skill_dirs(overrides_dir)} if overrides_dir and overrides_dir.is_dir() else {}
    report: dict[str, list[str]] = {"seeded": [], "unreviewed": [], "overridden": [], "override_only": [],
                                    "essential_off": [], "default_off": []}
    keep: list[Path] = []
    labels: list[tuple[str, Path]] = []
    for d in skill_dirs(upstream):
        key = f"{upstream_prefix}/{d.relative_to(upstream).as_posix()}"
        if d.name in override_dirs:
            report["overridden"].append(key)
            continue
        tree = git_tree_id(d)
        entry = (reviewed or {}).get(key) or {}
        if reviewed is None or entry.get("tree") != tree:
            report["unreviewed"].append(key)
            continue
        if str(entry.get("default", "on")).lower() == "off":
            if d.name in ESSENTIAL_SKILLS:
                report["essential_off"].append(key)
                continue
            report["default_off"].extend(sorted(skill_names(d)))
        keep.append(d)
        labels.append((key, d))
        report["seeded"].append(key)
    upstream_names = {d.name for d in skill_dirs(upstream)}
    for name, d in override_dirs.items():
        labels.append((f"overrides/{name}", d))
        if name not in upstream_names:
            report["override_only"].append(name)
    digest = content_hash(labels) if labels else "empty"
    final = layout.seed_root / digest / "skills"
    if final.is_dir():
        return final, report
    layout.seed_root.mkdir(parents=True, exist_ok=True)
    staging_root = Path(tempfile.mkdtemp(prefix=".build-", dir=layout.seed_root))
    staging = staging_root / "skills"
    staging.mkdir()
    # Category DESCRIPTION.md files and other non-skill files sit beside the skill folders.
    skill_set = {d.resolve() for d in skill_dirs(upstream)}
    for path in sorted(upstream.rglob("*")):
        if any(part in IGNORED_NAMES for part in path.parts) or not path.is_file():
            continue
        if any(parent.resolve() in skill_set for parent in path.parents):
            continue
        if path.name in ("AGENTS.md",):
            continue
        dest = staging / path.relative_to(upstream)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
    for d in keep:
        _copy_tree(d, staging / d.relative_to(upstream))
    upstream_by_name = {d.name: d for d in skill_dirs(upstream)}
    for name, d in override_dirs.items():
        target = upstream_by_name.get(name)
        rel = target.relative_to(upstream) if target else Path("timely") / name
        dest = staging / rel
        if dest.exists():
            shutil.rmtree(dest)
        _copy_tree(d, dest)
    final.parent.mkdir(parents=True, exist_ok=True)
    _publish(staging, final)
    shutil.rmtree(staging_root, ignore_errors=True)
    return final, report

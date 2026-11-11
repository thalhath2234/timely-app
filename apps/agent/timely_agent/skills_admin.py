""""Updated upstream" for bundled skills the person (or the agent) changed (plan 9.3, 9b.6; Q-3.7).

Runs inside the worker after ``ready`` (Hermes imported, ``HERMES_HOME`` is the account home).
Edits to a bundled skill are copy-on-write by construction: the account's ``skills/`` holds its own
copy, Hermes' manifest (``skills/.bundled_manifest``) records the hash of the version it seeded, and
every change goes through the skill ledger, so Undo is ``rollback_entry``.

After a Timely upgrade, Hermes' ``sync_skills`` (run by the worker at start) updates pristine copies
and skips edited ones, reporting them as ``user_modified`` when their shipped version changed. It
also never overwrites a same-named skill the account already had (a learned skill named like a
newly shipped bundled one). This module lists both, in the same terms as ``sync_skills``:

- ``edited``: in the manifest, the account's copy differs from the seeded version and the shipped
  version differs from the seeded version (``tools.skills_sync._update_existing_skill``);
- ``collision``: not in the manifest, the account has a folder at the shipped skill's path and it
  differs from the shipped version (``_install_new_skill``).

``learning.upstream`` (PROTOCOL.md section 10):

- ``list``: ``{upstream: [{name, kind, upstream_changed_at}], count}``
- ``compare``: ``{name, kind, mine, upstream, diff}`` (``diff`` turns the account's copy into the
  shipped version, every file of the skill)
- ``keep_mine``: records the shipped version's hash in ``.timely/upstream.json`` so the notice clears
  until the next shipped change; the account's copy and Hermes' manifest are untouched
- ``use_new``: ``tools.skills_sync_bundled_ops.reset_bundled_skill(name, restore=True)``, recorded in
  the ledger with actor ``user`` first, so the person can undo it like any other change
"""

from __future__ import annotations

import difflib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional

STATE_FILE = "upstream.json"  # in <home>/.timely/
ACTIONS = ("list", "compare", "keep_mine", "use_new")


class ApiError(Exception):
    """Raised for a request Go should answer with an ``error`` (code, message)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _home() -> Path:
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home())


def _state_path() -> Path:
    return _home() / ".timely" / STATE_FILE


def _read_state() -> dict[str, Any]:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    for key in ("kept", "seen"):
        if not isinstance(data.get(key), dict):
            data[key] = {}
    return data


def _write_state(data: dict[str, Any]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{STATE_FILE}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"version": 1, "kept": data["kept"], "seen": data["seen"]}, indent=1,
                              sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _changed() -> dict[str, dict[str, Any]]:
    """``{name: {kind, src, dest, upstream_hash}}`` before the person's keep_mine choices."""
    from tools.skills_sync import (_build_external_skill_index, _compute_relative_dest, _discover_bundled_skills,
                                   _get_bundled_dir, _matches_origin_hash, _read_manifest, _read_suppressed_names,
                                   dir_hash)
    bundled_dir = _get_bundled_dir()
    manifest = _read_manifest()
    suppressed = _read_suppressed_names()
    try:
        external = _build_external_skill_index()
    except Exception:
        external = set()
    out: dict[str, dict[str, Any]] = {}
    for name, src in _discover_bundled_skills(bundled_dir):
        if name in suppressed or name in external:
            continue
        dest = _compute_relative_dest(src, bundled_dir)
        if not dest.is_dir():
            continue
        upstream_hash = dir_hash(src)
        origin = manifest.get(name, "")
        if name in manifest:
            if origin and upstream_hash != origin and not _matches_origin_hash(dest, origin):
                out[name] = {"kind": "edited", "src": src, "dest": dest, "upstream_hash": upstream_hash}
        elif dir_hash(dest) != upstream_hash:
            out[name] = {"kind": "collision", "src": src, "dest": dest, "upstream_hash": upstream_hash}
    return out


def pending(record: bool = True) -> dict[str, dict[str, Any]]:
    """The skills that show "Updated upstream": changed ones whose shipped hash the person has not
    kept. ``record`` notes when each shipped version was first seen (``upstream_changed_at``)."""
    state = _read_state()
    out = {}
    dirty = False
    now = datetime.now(UTC).isoformat()
    for name, row in _changed().items():
        if state["kept"].get(name) == row["upstream_hash"]:
            continue
        seen = state["seen"].get(name)
        if not isinstance(seen, dict) or seen.get("hash") != row["upstream_hash"]:
            seen = {"hash": row["upstream_hash"], "at": now}
            state["seen"][name] = seen
            dirty = True
        out[name] = {**row, "upstream_changed_at": seen["at"]}
    if record and dirty:
        _write_state(state)
    return out


def upstream_count() -> int:
    """``ready.skills_upstream``: how many skills show "Updated upstream"."""
    return len(pending())


def _files(root: Path) -> list[str]:
    from tools.skills_sync_optional import _skill_file_list
    return sorted(_skill_file_list(root)) if root.is_dir() else []


def _text(path: Path) -> Optional[str]:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _diff(mine: Path, upstream: Path) -> str:
    out: list[str] = []
    for rel in sorted(set(_files(mine)) | set(_files(upstream))):
        a, b = mine / rel, upstream / rel
        ta = _text(a) if a.is_file() else ""
        tb = _text(b) if b.is_file() else ""
        if ta is None or tb is None:
            if (a.read_bytes() if a.is_file() else b"") != (b.read_bytes() if b.is_file() else b""):
                out.append(f"Binary file {rel} differs\n")
            continue
        out += difflib.unified_diff(ta.splitlines(keepends=True), tb.splitlines(keepends=True),
                                    fromfile=f"mine/{rel}", tofile=f"upstream/{rel}")
    return "".join(out)


def _need(name: Any, rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(name, str) or not name.strip():
        raise ApiError("bad_message", "learning.upstream needs name")
    if name not in rows:
        raise ApiError("not_found", f"'{name}' has no upstream change to review")
    return rows[name]


def _use_new(name: str, row: dict[str, Any]) -> dict[str, Any]:
    from tools.skill_ledger import capture_before, record_mutation
    from tools.skills_sync_bundled_ops import reset_bundled_skill
    from timely_agent.learning import api as learning_api
    dest: Path = row["dest"]
    before = capture_before(dest)
    result = reset_bundled_skill(name, restore=True)
    if not result.get("ok"):
        raise learning_api.Failed({"message": result.get("message") or "the shipped version could not be restored"})
    entry_id = record_mutation("edit", name, before=before, after_root=dest, actor="user",
                                            evidence={"upstream": "use_new"})
    learning_api._clear_skill_caches()
    events = learning_api._emit_ledger(name)
    state = _read_state()
    state["kept"].pop(name, None)
    state["seen"].pop(name, None)
    _write_state(state)
    return {"ok": True, "name": name, "message": result.get("message") or "", "ledger_entry_id": entry_id or "",
            "events": events, "count": len(pending())}


def handle(msg: dict[str, Any]) -> dict[str, Any]:
    """``learning.upstream`` (``worker-learning``'s dispatch calls this); returns the ``data``."""
    from timely_agent.learning import api as learning_api
    action = msg.get("action")
    if action not in ACTIONS:
        raise learning_api.ApiError("bad_message", "learning.upstream action must be list, compare, keep_mine or use_new")
    try:
        rows = pending()
        if action == "list":
            items = [{"name": n, "kind": r["kind"], "upstream_changed_at": r["upstream_changed_at"]}
                     for n, r in sorted(rows.items())]
            return {"upstream": items, "count": len(items)}
        name = msg.get("name")
        row = _need(name, rows)
        if action == "compare":
            mine, upstream = row["dest"], row["src"]
            return {"name": name, "kind": row["kind"], "mine": _text(mine / "SKILL.md") or "",
                    "upstream": _text(upstream / "SKILL.md") or "", "diff": _diff(mine, upstream)}
        if action == "keep_mine":
            state = _read_state()
            state["kept"][name] = row["upstream_hash"]
            _write_state(state)
            return {"ok": True, "name": name, "kept": True, "count": len(pending())}
        return _use_new(name, row)
    except ApiError as exc:
        raise learning_api.ApiError(exc.code, exc.message) from None

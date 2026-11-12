"""Where an account home keeps what Hermes learned, and plain readers for it (no Hermes import).

The layout is Hermes' own (``tools/memory_tool.py``, ``tools/skill_ledger.py``,
``tools/write_approval.py``, ``tools/skill_usage.py``); Timely adds ``.timely/``.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

ENTRY_DELIMITER = "\n§\n"  # tools/memory_tool_store.py ENTRY_DELIMITER
MEMORY_FILES = {"memory": "MEMORY.md", "user": "USER.md"}
MEMORY_LIMITS = {"memory": 2200, "user": 1375}  # plan 9b.1; config_render renders the same numbers
TEXT_CAP = 20000  # before/after in a learning event (PROTOCOL.md section 10)


def home_dir() -> Path:
    return Path(os.environ["HERMES_HOME"]).resolve()


def memory_path(home: Path, target: str) -> Path:
    return home / "memories" / MEMORY_FILES[target]


def read_memory(home: Path, target: str) -> list[str]:
    """The entries of MEMORY.md (``memory``) or USER.md (``user``), as Hermes splits them."""
    try:
        raw = memory_path(home, target).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return []
    return list(dict.fromkeys(e for e in (x.strip() for x in raw.split(ENTRY_DELIMITER)) if e))


def ledger_path(home: Path) -> Path:
    return home / "skills" / ".curator_ledger.jsonl"


def read_ledger(home: Path) -> list[dict[str, Any]]:
    """Ledger entries, oldest first; malformed lines skipped."""
    try:
        raw = ledger_path(home).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    rows = []
    for line in raw.splitlines():
        try:
            row = json.loads(line) if line.strip() else None
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("id"):
            rows.append(row)
    return rows


def read_blob(home: Path, sha: str) -> Optional[str]:
    if not sha or not all(c in "0123456789abcdef" for c in str(sha)):
        return None
    try:
        return (home / ".curator_backups" / "blobs" / sha).read_bytes().decode("utf-8", "replace")
    except OSError:
        return None


def pending_ids(home: Path) -> dict[str, str]:
    """``{pending_id: subsystem}`` of every staged write (``pending/{memory,skills}/<id>.json``)."""
    out = {}
    for subsystem in ("memory", "skills"):
        d = home / "pending" / subsystem
        if d.is_dir():
            for p in d.glob("*.json"):
                out[p.stem] = subsystem
    return out


def read_pending(home: Path, subsystem: str, pending_id: str) -> Optional[dict[str, Any]]:
    try:
        data = json.loads((home / "pending" / subsystem / f"{pending_id}.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def usage(home: Path) -> dict[str, dict[str, Any]]:
    """``skills/.usage.json`` (Hermes' skill telemetry and curator state)."""
    try:
        data = json.loads((home / "skills" / ".usage.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


def timely_dir(home: Path) -> Path:
    return home / ".timely"


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, data: Any) -> None:
    """Atomic write (temp file in the same folder, then rename)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, sort_keys=True, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def pending_meta_path(home: Path, pending_id: str) -> Path:
    return timely_dir(home) / "pending" / f"{pending_id}.json"


def cut(text: Any) -> str:
    text = "" if text is None else str(text)
    return text if len(text) <= TEXT_CAP else text[:TEXT_CAP]

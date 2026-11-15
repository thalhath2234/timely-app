"""The exec trap (phase 5, decision 20): no destructive command a test drives can ever execute.

Installed in a worker process by ``tests/contract/probe_boot.py --exec-trap LOG`` (the harness does it
for every host-allowed agent) before Hermes is imported. It replaces ``subprocess.Popen`` with a
subclass that records every command line to ``LOG`` (JSON lines) and, for a command matching
``DESTRUCTIVE``, starts a harmless stand-in instead (``echo EXEC_TRAP: not run``) and records
``trapped: true``. Hermes' local terminal backend, its process registry and ``execute_code``'s
child all start processes through ``subprocess.Popen``, so a test that approves ``rm -rf`` proves
the approval path end to end while nothing is deleted.

``records(log)`` reads the log back for assertions (``ran(log, marker)``, ``trapped(log)``).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

# Command lines the trap never lets run. Broader than Hermes' own lists on purpose.
DESTRUCTIVE = [re.compile(p, re.IGNORECASE) for p in (
    # rm -r / -rf / -R (not Hermes' own `rm -f <tmp>` housekeeping in its shell wrappers)
    r"\brm\s+(-[^\s]*\s+)*-[^\s]*[rR]",
    r"\brm\s+(-[^\s]+\s+)*--recursive",
    r"\bchmod\s+(-[^\s]+\s+)*-[^\s]*R",          # chmod -R
    r"\bchown\s+(-[^\s]+\s+)*-[^\s]*R",
    r"\|\s*(sudo\s+)?(ba|z|da|k)?sh\b",          # curl ... | sh
    r"\bmkfs",
    r":\(\)\s*\{",                              # fork bomb
    r"\bdd\s+[^\n]*of=/dev/",
    r">\s*/dev/(sd|nvme|hd|vd|xvd)",
    r"\bshred\b", r"\bwipefs\b",
    r"\b(shutdown|reboot|poweroff|halt)\b",
    r"\bkill\s+(-[^\s]+\s+)*-1\b",
)]
_lock = threading.Lock()


def _cmdline(args) -> str:
    if isinstance(args, (str, bytes)):
        return args.decode("utf-8", "replace") if isinstance(args, bytes) else args
    try:
        return " ".join(str(a) for a in args)
    except TypeError:
        return str(args)


def is_destructive(cmd: str) -> bool:
    return any(p.search(cmd) for p in DESTRUCTIVE)


def install(log_path: str) -> None:
    log = Path(log_path)
    log.parent.mkdir(parents=True, exist_ok=True)
    original = subprocess.Popen
    if getattr(original, "_timely_trap", False):
        return

    def record(entry: dict) -> None:
        with _lock, open(log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    class TrapPopen(original):  # type: ignore[misc, valid-type]
        _timely_trap = True

        def __init__(self, args, *a, **kw):
            cmd = _cmdline(args)
            env = kw.get("env") or {}
            entry = {"cmd": cmd[-4000:], "cwd": str(kw.get("cwd") or ""), "home": str(env.get("HOME") or ""),
                     "trapped": False}
            if is_destructive(cmd):
                entry["trapped"] = True
                args = [sys.executable, "-I", "-c", "print('EXEC_TRAP: not run')"]
                kw.pop("shell", None)
                kw.pop("executable", None)
            record(entry)
            super().__init__(args, *a, **kw)

    subprocess.Popen = TrapPopen  # type: ignore[misc]


def records(log_path: str | os.PathLike) -> list[dict]:
    path = Path(log_path)
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def trapped(log_path: str | os.PathLike) -> list[dict]:
    return [r for r in records(log_path) if r.get("trapped")]


SHELLS = ("bash", "sh", "zsh", "dash")


def _shell(cmd: str) -> bool:
    first = cmd.split(" ", 1)[0]
    return first.rsplit("/", 1)[-1] in SHELLS


def ran(log_path: str | os.PathLike, marker: str) -> list[dict]:
    """Shell commands that were really started (not trapped) whose line holds ``marker`` (Hermes'
    own helpers, such as the checkpoint's ``git commit-tree``, are not counted)."""
    return [r for r in records(log_path)
            if marker in r.get("cmd", "") and not r.get("trapped") and _shell(r.get("cmd", ""))]

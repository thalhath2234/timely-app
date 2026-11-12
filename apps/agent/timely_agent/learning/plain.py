"""Plain words for a ``learning.*`` request that did not succeed.

Hermes words its refusals for the model ("Retry as ONE 'operations' batch ...", "`hermes curator
unlock`"); Settings shows ``learning.result`` messages to the person as they are, so every failure
goes out through :func:`person_facing`. No Hermes import, so the unit tests load it directly."""

from __future__ import annotations

import re
from typing import Optional

LABEL = {"user": "About you", "memory": "Notes"}

GENERIC = "Timely couldn't make that change. Try again."
LOCKED = "This skill is locked. Unlock it first."
BLOCKED = "Timely won't save this: it reads like an instruction to change how Timely behaves."
NO_SKILL = "Timely can't find that skill anymore."
NO_ENTRY = "Timely can't find that change anymore."
NO_PENDING = "That isn't waiting for you anymore."
NO_ARCHIVE = "Built-in skills can't be archived. Turn the skill off instead."

# Words that only make sense to the model or in Hermes' own CLI and config.
_MODEL_FACING = re.compile(
    r"retry|`|\bhermes\b|\bcurator\.|prune_builtins|current_entries|old_text|skill_manage|"
    r"'operations'|\bsystem prompt\b|threat pattern|\bthe agent\b|\bDesktop\b",
    re.IGNORECASE)


def memory_failure(target: str, failure_class: str) -> str:
    """A failed About you or Notes change, from Hermes' memory store failure class."""
    label = LABEL.get(target, "Notes")
    if failure_class == "over_budget":
        return f"{label} is full. Delete or shorten an entry first."
    if failure_class == "scan_blocked":
        return BLOCKED
    if failure_class in ("no_match", "stale_entry"):
        return f"Timely can't find that entry in {label} anymore. Reload and try again."
    if failure_class == "ambiguous":
        return f"That matches more than one entry in {label}."
    if failure_class == "missing_content":
        return "Write something first."
    return f"Timely couldn't change {label}. Try again."


def skill_failure(message: Optional[str]) -> str:
    """A failed skill change: locks and Hermes' content scan in plain words, else
    :func:`person_facing`."""
    text = str(message or "")
    low = text.lower()
    if "locked by the user" in low or "is locked" in low:
        return LOCKED
    if "threat pattern" in low or "security scan" in low or "injection" in low:
        return BLOCKED
    if "bundled built-in" in low or "prune_builtins" in low:
        return NO_ARCHIVE
    return person_facing(text)


def person_facing(message: Optional[str], fallback: str = GENERIC) -> str:
    """``message`` when it reads as plain words for the person, else ``fallback``."""
    text = str(message or "").strip()
    if not text or _MODEL_FACING.search(text) or len(text) > 240:
        return fallback
    return text

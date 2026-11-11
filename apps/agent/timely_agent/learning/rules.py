"""The learning policy for one ``memory`` or ``skill_manage`` write (plan 9b.2, 9b.5; Q-3.1, Q-3.7).

``decide`` is pure: ``timely_learning`` gathers the facts (the conversation's taint and flags from
``bridge``, whether the call runs in the unattended learning pass) and acts on the answer.

In order:

1. ``block`` "off": the run did not turn learning writes on (``flags.learning_writes``), or there
   is no run or session to decide for.
2. ``block`` "threat": a strict threat-scan hit in any text the write carries
   (``tools.threat_patterns.first_threat_message``, scope ``strict``, as Hermes scans memory).
3. ``stage``: the conversation is tainted (outside content reached it, Q-3.1), the write comes from
   a bot (``flags.from_bot``, a ``bot`` run or a bot feedback review), it is an unattended memory
   ``patch``/``remove`` in the learning pass (Hermes stages those itself too), or the text matches
   the skill-body rule (``.hermes-sync/policy/skill-body.yaml``: a tool name the chat policy
   approves or blocks, as a whole token, or an authority phrase, case-insensitive).
4. ``allow``: everything else, silently with Undo. An edit to a bundled skill is the account's own
   copy (Hermes seeds bundled skills into the home), so it is copy-on-write by construction (Q-3.7).
"""

from __future__ import annotations

import functools
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from timely_agent import paths

ALLOW, STAGE, BLOCK = "allow", "stage", "block"
STAGED_MESSAGE = "Saved for the person to confirm in Timely; do not retry."
THREAT_MESSAGE = "Blocked: Timely will not save this ({reason}). Do not retry."
TEXT_KEYS = ("content", "new_string", "file_content", "old_string", "old_text", "new_text", "file_path", "name",
             "category")
BOT_KINDS = ("bot", "bot_review")
DESTRUCTIVE_MEMORY = ("patch", "remove", "replace")


@dataclass(frozen=True)
class Decision:
    action: str  # allow | stage | block
    reason: str = ""  # off | threat | tainted | bot | unattended | skill_body
    message: str = ""


@dataclass(frozen=True)
class SkillBodyRule:
    tool_tokens: frozenset
    patterns: tuple  # compiled, re.IGNORECASE
    broken: str = ""  # why the file could not be read: then every write matches (fail closed)

    def match(self, text: str) -> str:
        """What matched (``tool:<name>`` or ``phrase:<pattern>``), else ""."""
        if self.broken:
            return f"rule unavailable: {self.broken}"
        if not text:
            return ""
        for token in re.findall(r"[A-Za-z0-9_]+", text):
            if token in self.tool_tokens:
                return f"tool:{token}"
        for pattern in self.patterns:
            if pattern.search(text):
                return f"phrase:{pattern.pattern}"
        return ""


def _scalar(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] == "'":
        return raw[1:-1].replace("''", "'")
    if len(raw) >= 2 and raw[0] == raw[-1] == '"':
        return bytes(raw[1:-1], "utf-8").decode("unicode_escape")
    return raw


def parse_skill_body(text: str) -> dict[str, list[str]]:
    """The two lists of skill-body.yaml (a small YAML subset: top-level keys, ``- item`` lists)."""
    out: dict[str, list[str]] = {}
    key = None
    for line in text.splitlines():
        stripped = line.rstrip()
        if not stripped.strip() or stripped.lstrip().startswith("#"):
            continue
        if not line.startswith((" ", "-")) and stripped.endswith(":"):
            key = stripped[:-1].strip()
            out[key] = []
        elif not line.startswith((" ", "-")):
            key = None
        elif key is not None and stripped.lstrip().startswith("- "):
            out[key].append(_scalar(stripped.lstrip()[2:]))
    return out


def skill_body_file():
    return paths.agent_dir() / ".hermes-sync" / "policy" / "skill-body.yaml"


@functools.lru_cache(maxsize=1)
def skill_body_rule() -> SkillBodyRule:
    try:
        data = parse_skill_body(skill_body_file().read_text(encoding="utf-8"))
        tokens = frozenset(data.get("tool_tokens") or [])
        patterns = tuple(re.compile(p, re.IGNORECASE) for p in data.get("authority_patterns") or [])
        if not tokens or not patterns:
            return SkillBodyRule(frozenset(), (), broken="skill-body.yaml has no tool_tokens or authority_patterns")
        return SkillBodyRule(tokens, patterns)
    except (OSError, re.error, UnicodeDecodeError) as exc:
        return SkillBodyRule(frozenset(), (), broken=f"{type(exc).__name__}: {exc}")


def write_texts(args: dict[str, Any]) -> list[str]:
    """Every text a ``memory`` or ``skill_manage`` call would write (flat and ``operations``)."""
    out: list[str] = []

    def take(d: dict) -> None:
        for key in TEXT_KEYS:
            value = d.get(key)
            if isinstance(value, str) and value:
                out.append(value)

    take(args)
    for op in args.get("operations") or []:
        if isinstance(op, dict):
            take(op)
    return out


def body_texts(args: dict[str, Any]) -> list[str]:
    """The texts the skill-body rule reads: what lands in the store, not the names or anchors."""
    keys = ("content", "new_string", "file_content", "new_text")
    out = [args[k] for k in keys if isinstance(args.get(k), str) and args.get(k)]
    for op in args.get("operations") or []:
        if isinstance(op, dict):
            out += [op[k] for k in keys if isinstance(op.get(k), str) and op.get(k)]
    return out


def memory_actions(args: dict[str, Any]) -> list[str]:
    ops = args.get("operations")
    if isinstance(ops, list) and ops:
        return [str((op or {}).get("action") or "") for op in ops if isinstance(op, dict)]
    return [str(args.get("action") or "")]


def decide(tool: str, args: dict[str, Any], *, learning_writes: bool, tainted: bool, from_bot: bool,
           kind: str, unattended: bool, threat: Callable[[str], Optional[str]],
           rule: Optional[SkillBodyRule] = None) -> Decision:
    if not learning_writes:
        return Decision(BLOCK, "off")
    for text in write_texts(args):
        hit = threat(text)
        if hit:
            return Decision(BLOCK, "threat", THREAT_MESSAGE.format(reason=str(hit)[:200]))
    if tainted:
        return Decision(STAGE, "tainted", STAGED_MESSAGE)
    if from_bot or kind in BOT_KINDS:
        return Decision(STAGE, "bot", STAGED_MESSAGE)
    if tool == "memory" and unattended and any(a in DESTRUCTIVE_MEMORY for a in memory_actions(args)):
        return Decision(STAGE, "unattended", STAGED_MESSAGE)
    rule = rule or skill_body_rule()
    for text in body_texts(args):
        hit = rule.match(text)
        if hit:
            return Decision(STAGE, "skill_body", STAGED_MESSAGE)
    return Decision(ALLOW)


def any_match(rule: SkillBodyRule, texts: Iterable[str]) -> str:
    for text in texts:
        hit = rule.match(text)
        if hit:
            return hit
    return ""

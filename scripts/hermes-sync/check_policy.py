"""Tool and skill policy checks for `make hermes-sync-check` (plan 8.1, 9.1-9.3, 9b.2, 10.4 e).

Stdlib only; run with python3 -I (check_sync.py imports it). Every function returns a list of
failure messages, so the tests can drive each rule with small fixtures.

Files (apps/agent/.hermes-sync/):
  tools.json                 runtime tool dump (check_dump.py), committed so a sync PR shows the diff
  skills.json                bundled and optional skills: folder, name, git tree id, Hermes-self signals
  policy/tools.yaml          every tool by name and owner: chat/bot disposition, phase, reviewed schema hash
  policy/skills-reviewed.json  reviewed tree id per skill; `default` on/off for bundled, `offered` for optional
  policy/skill-body.yaml     tool tokens (generated from tools.yaml) and authority regexes for the skill-body rule
"""
import json
import os
import re

import check_lib

DISPOSITIONS = {"allow", "approve", "block"}
PHASES = set(range(0, 9)) | {"later", "never"}
GATES = {
    "learning", "timely-skills-readonly", "session-taint", "delegate-cap", "web-toggle",
    "bot-egress", "xai-key", "host-path-approve", "urls-only", "skills-folder-allow", "clarify-card",
    "no-secret-capture", "private-target",
}
OWNER_RE = re.compile(r"^(core|plugin:[A-Za-z0-9_./-]+|mcp:[A-Za-z0-9_.-]+)$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TREE_RE = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")
TIMELY_OWNER = "plugin:timely_"
SKILL_ROOTS = ("skills", "optional-skills")
# Hermes-self signals (plan 9.2): the skill runs `hermes <command>` or names a literal ~/.hermes path
# (the host user's own home, never an account home). `${HERMES_HOME:-~/.hermes}` follows the worker's
# HERMES_HOME and is not a signal.
HERMES_CLI_RE = re.compile(r"(?<![\w/.-])hermes ([a-z][a-z-]+)\b")
HERMES_CLI_SUBCOMMANDS = {
    "acp", "auth", "bot", "chat", "config", "cron", "curator", "dashboard", "desktop", "doctor", "gateway",
    "kanban", "login", "logout", "mcp", "memory", "model", "pairing", "plugins", "pm", "profile", "sessions",
    "setup", "skills", "status", "tools", "update", "computer-use", "insights", "claw", "honcho", "webhook",
    "teams-pipeline", "backup", "import", "uninstall", "logs",
}
HOME_PATH_RE = re.compile(r"(?<![-:{])(~|\$HOME|\$\{HOME\})/\.hermes\b")
# `hermes <command>` uses that do not make a skill Hermes-self (the deny list, plan 9.2): every one
# was read in the v0.23.0 copy (docs/plans/2026-11-11-phase3-skills-review.md).
#   skills  `hermes skills install official/...`: a pointer to an optional skill (Timely offers
#           optional skills in Settings; the worker has no `hermes` on PATH)
#   pm      `hermes pm environment ...`: the document skills' interpreter step, guarded by
#           `command -v hermes` with a plain-venv fallback
#   chat    `hermes chat -q`: describes Hermes' one-shot mode, never asks the agent to run it
HERMES_CLI_MENTION_ONLY = {"skills", "pm", "chat"}
# Frontmatter conditions (agent.skill_utils._CONDITION_KEYS) the deny list reads.
_FRONTMATTER_LIST_RE = re.compile(r"^(\s*)(requires_toolsets|requires_tools|session_platforms)\s*:\s*(.*)$")
_TOOL_TOKEN_RE = re.compile(r"(?<![\w-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![\w-])")

TOOLS_YAML = check_lib.POLICY_DIR + "/tools.yaml"
SKILLS_REVIEWED = check_lib.POLICY_DIR + "/skills-reviewed.json"
SKILLS_DENIED = check_lib.POLICY_DIR + "/skills-denied.json"
SKILL_BODY = check_lib.POLICY_DIR + "/skill-body.yaml"
TOOLS_JSON = check_lib.SYNC_DIR + "/tools.json"
SKILLS_JSON = check_lib.SYNC_DIR + "/skills.json"
GEN_BEGIN = "# BEGIN generated tool_tokens"
GEN_END = "# END generated tool_tokens"
REGEN = "python3 -I scripts/hermes-sync/check_sync.py --write"


_WORKER_POLICY = []


def worker_floor_blocks(name):
    """Whether the worker's phase-1 name floor (``timely_agent.policy.is_blocked``, stdlib only)
    blocks ``name``. Loaded from the file, so the check needs nothing on sys.path."""
    if not _WORKER_POLICY:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "_timely_policy", check_lib.path(check_lib.AGENT_DIR + "/timely_agent/policy.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _WORKER_POLICY.append(mod)
    return _WORKER_POLICY[0].is_blocked(name)


def split_key(key):
    name, sep, owner = key.partition("@")
    return (name, owner) if sep and name and owner else (None, None)


# ---------------------------------------------------------------- tools.yaml
def validate_tools_policy(policy):
    msgs = []
    if not isinstance(policy, dict):
        return ["tools.yaml: top level must be a mapping"]
    if policy.get("version") != 1:
        msgs.append("tools.yaml: version must be 1")
    if policy.get("unknown") != "block":
        msgs.append("tools.yaml: `unknown: block` is required (unknown tools stay off)")
    for section in ("tools", "inline"):
        entries = policy.get(section)
        if not isinstance(entries, dict):
            msgs.append(f"tools.yaml: `{section}` must be a mapping")
            continue
        for key, e in entries.items():
            name, owner = split_key(key)
            where = f"tools.yaml {section}.{key}"
            if not name or not OWNER_RE.match(owner):
                msgs.append(f"{where}: key must be <name>@<owner> with owner core, plugin:<id> or mcp:<server>")
                continue
            if not isinstance(e, dict):
                msgs.append(f"{where}: must be a mapping")
                continue
            required = ("chat", "bot", "phase", "note") + (("toolset",) if section == "tools" else ())
            for field in required:
                if field not in e:
                    msgs.append(f"{where}: missing `{field}`")
            known = {"toolset", "chat", "bot", "phase", "gates", "schema", "note"}
            for field in sorted(set(e) - known):
                msgs.append(f"{where}: unknown field `{field}`")
            for kind in ("chat", "bot"):
                if kind in e and e[kind] not in DISPOSITIONS:
                    msgs.append(f"{where}: {kind} must be allow, approve or block (got {e[kind]!r})")
            if "phase" in e and e["phase"] not in PHASES:
                msgs.append(f"{where}: phase must be 0-8, later or never (got {e['phase']!r})")
            if e.get("phase") == "never" and (e.get("chat") != "block" or e.get("bot") != "block"):
                msgs.append(f"{where}: phase never needs chat and bot block")
            if e.get("phase") == "never" and not worker_floor_blocks(name):
                msgs.append(f"{where}: phase never, but the worker's name floor (apps/agent/timely_agent/policy.py "
                            f"BLOCKED_TOOLS, BLOCKED_PREFIXES, MESSAGING_*) does not block `{name}`; add it there")
            gates = e.get("gates", [])
            if not isinstance(gates, list) or any(g not in GATES for g in gates):
                msgs.append(f"{where}: gates must be a list from {sorted(GATES)} (got {gates!r})")
            offered = e.get("chat") != "block" or e.get("bot") != "block"
            if section == "tools" and offered and not SHA256_RE.match(str(e.get("schema", ""))):
                msgs.append(f"{where}: allowed or approved tools need the reviewed `schema` sha256")
            if not isinstance(e.get("note", ""), str) or not e.get("note", "x").strip():
                msgs.append(f"{where}: note must be a non-empty string")
    return msgs


def check_tools(policy, dump):
    """Every registry tool classified by name and owner; reviewed schemas current; no stale entries."""
    msgs = validate_tools_policy(policy)
    entries = policy.get("tools") if isinstance(policy, dict) and isinstance(policy.get("tools"), dict) else {}
    by_name = {}
    for key, e in entries.items():
        name, owner = split_key(key)
        if name:
            by_name.setdefault(name, {})[owner] = e if isinstance(e, dict) else {}
    tools = dump.get("tools", {})
    for name, t in sorted(tools.items()):
        owner = t["owner"]
        listed = by_name.get(name, {})
        if not listed:
            msgs.append(f"new tool `{name}` (toolset {t['toolset']}, owner {owner}) is not classified: add "
                        f"`{name}@{owner}` to {TOOLS_YAML} (schema {t['schema_sha256']}); the phase-2 gate blocks a tool with no entry")
            continue
        if owner not in listed:
            msgs.append(f"tool `{name}` is registered by {owner} but {TOOLS_YAML} lists it for "
                        f"{', '.join(sorted(listed))}; the phase-2 gate blocks an owner mismatch. Review who registers it now")
            continue
        e = listed[owner]
        if e.get("toolset") != t["toolset"]:
            msgs.append(f"tool `{name}@{owner}` moved from toolset {e.get('toolset')} to {t['toolset']}: update {TOOLS_YAML}")
        offered = e.get("chat") != "block" or e.get("bot") != "block"
        if offered and e.get("schema") != t["schema_sha256"]:
            msgs.append(f"tool `{name}@{owner}` ({e.get('chat')} in chat, {e.get('bot')} in bots) has a new schema: "
                        f"read it, then set schema: \"{t['schema_sha256']}\" in {TOOLS_YAML} (was {e.get('schema')})")
    for name, owners in sorted(by_name.items()):
        for owner in sorted(owners):
            live = tools.get(name)
            if live and live["owner"] == owner:
                continue
            if owner.startswith(TIMELY_OWNER) or owner.startswith("mcp:"):
                continue  # Timely plugin tools join the dump when their plugins load; MCP tools are per account
            if live is None:
                msgs.append(f"{TOOLS_YAML} lists `{name}@{owner}` but Hermes no longer registers `{name}`: remove the entry")
            elif live["owner"] not in owners:
                pass  # already reported as an owner mismatch above
            else:
                msgs.append(f"{TOOLS_YAML} lists `{name}@{owner}` but only {live['owner']} registers it: remove the entry")
    inline = policy.get("inline") if isinstance(policy, dict) and isinstance(policy.get("inline"), dict) else {}
    inline_names = {split_key(k)[0] for k in inline}
    dumped_inline = set(dump.get("inline", {}).get("bridge", []))
    if dump.get("inline", {}).get("message_agent"):
        dumped_inline.add(dump["inline"]["message_agent"]["name"])
    for name in sorted(dumped_inline - inline_names):
        msgs.append(f"inline tool `{name}` (handled before the registry) is not classified under `inline:` in {TOOLS_YAML}")
    for name in sorted(inline_names - dumped_inline):
        msgs.append(f"{TOOLS_YAML} `inline:` lists `{name}` but Hermes no longer has it: remove the entry")
    for name in dump.get("inline", {}).get("agent_loop", []):
        if name not in tools:
            msgs.append(f"agent-loop tool `{name}` is not in the tool registry any more: review model_tools._AGENT_LOOP_TOOLS")
    return msgs


def tools_document(dump, upstream):
    return {"version": 1, "upstream": upstream,
            "about": "Runtime tool registry of the Hermes copy with every bundled plugin enabled "
                     "(scripts/hermes-sync/check_dump.py). Regenerate: " + REGEN,
            "count": len(dump["tools"]), "tools": dump["tools"], "inline": dump["inline"], "plugins": dump["plugins"]}


def compare_dump(committed, current, what, keys):
    """Differences between a committed dump and the fresh one, one message per changed entry."""
    msgs = []
    for key in keys:
        old, new = committed.get(key), current.get(key)
        if old == new:
            continue
        if isinstance(old, dict) and isinstance(new, dict):
            for k in sorted(set(old) | set(new)):
                if k not in old:
                    msgs.append(f"{what}: `{k}` is new in {key}")
                elif k not in new:
                    msgs.append(f"{what}: `{k}` is gone from {key}")
                elif old[k] != new[k]:
                    msgs.append(f"{what}: `{k}` changed in {key}: {json.dumps(old[k], sort_keys=True)} -> {json.dumps(new[k], sort_keys=True)}")
        else:
            msgs.append(f"{what}: `{key}` changed: {json.dumps(old, sort_keys=True)} -> {json.dumps(new, sort_keys=True)}")
    if msgs:
        msgs.append(f"{what} is out of date: review the changes above, then regenerate with `{REGEN}`")
    return msgs


# ---------------------------------------------------------------- skills
def skill_trees(rev="HEAD", repo=None):
    """{root-relative skill folder: git tree id} for every SKILL.md under skills/ and optional-skills/."""
    out = check_lib.git("ls-tree", "-r", "-t", "-z", rev, "--",
                        *(f"{check_lib.PREFIX}/{r}" for r in SKILL_ROOTS), repo=repo)
    trees, folders = {}, []
    for row in out.split("\0"):
        if not row:
            continue
        meta, rel = row.split("\t", 1)
        mode, kind, oid = meta.split()
        rel = rel[len(check_lib.PREFIX) + 1:]
        if kind == "tree":
            trees[rel] = oid
        elif rel.endswith("/SKILL.md"):
            folders.append(rel[: -len("/SKILL.md")])
    return {f: trees[f] for f in sorted(folders) if f in trees}


def frontmatter_name(text, fallback):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        for line in text[3:end].splitlines() if end > 0 else []:
            if line.startswith("name:"):
                return line[5:].strip().strip("'\"") or fallback
    return fallback


def skill_signals(folder):
    """Hermes-self signals over every text file of a skill folder (working tree)."""
    cli, home = set(), False
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for f in sorted(filenames):
            try:
                with open(os.path.join(dirpath, f), encoding="utf-8") as fh:
                    text = fh.read()
            except (UnicodeDecodeError, OSError):
                continue
            cli.update(m for m in HERMES_CLI_RE.findall(text) if m in HERMES_CLI_SUBCOMMANDS)
            home = home or bool(HOME_PATH_RE.search(text))
    return sorted(cli), home


def skills_document(trees, hermes_dir, upstream):
    doc = {"version": 1, "upstream": upstream,
           "about": "Bundled and optional skills in the copy: folder, frontmatter name, git tree id and "
                    "Hermes-self signals (`hermes <command>` uses, literal ~/.hermes paths). Regenerate: " + REGEN,
           "bundled": {}, "optional": {}}
    for rel, tree in trees.items():
        folder = os.path.join(hermes_dir, rel)
        try:
            with open(os.path.join(folder, "SKILL.md"), encoding="utf-8") as fh:
                name = frontmatter_name(fh.read(), rel.rsplit("/", 1)[-1])
        except OSError:
            name = rel.rsplit("/", 1)[-1]
        cli, home = skill_signals(folder)
        section = "bundled" if rel.startswith("skills/") else "optional"
        doc[section][rel] = {"name": name, "tree": tree, "hermes_cli": cli, "home_paths": home}
    return doc


# ---------------------------------------------------------------- skills-denied.json (plan 9.2)
def frontmatter_conditions(text):
    """``{requires_toolsets, requires_tools, session_platforms}`` lists from a SKILL.md frontmatter
    (inline ``[a, b]`` or block ``- a`` lists; stdlib only, so the check reads no YAML library)."""
    out = {}
    if not text.startswith("---"):
        return out
    end = text.find("\n---", 3)
    lines = text[3:end].splitlines() if end > 0 else []
    i = 0
    while i < len(lines):
        m = _FRONTMATTER_LIST_RE.match(lines[i])
        i += 1
        if not m:
            continue
        indent, key, rest = len(m.group(1)), m.group(2), m.group(3).split("#", 1)[0].strip()
        items = []
        if rest.startswith("["):
            items = [x.strip().strip("'\"") for x in rest.strip("[]").split(",")]
        elif rest:
            items = [rest.strip("'\"")]
        else:
            while i < len(lines) and lines[i].strip().startswith("- ") and len(lines[i]) - len(lines[i].lstrip()) >= indent:
                items.append(lines[i].strip()[2:].split("#", 1)[0].strip().strip("'\""))
                i += 1
        out.setdefault(key, []).extend(x for x in items if x)
    return out


def _skill_texts(folder):
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for f in sorted(filenames):
            try:
                with open(os.path.join(dirpath, f), encoding="utf-8") as fh:
                    yield f, fh.read()
            except (UnicodeDecodeError, OSError):
                continue


def never_tools(policy):
    """``(tool names, toolsets)`` Timely never offers (``phase: never`` in tools.yaml); a toolset
    counts only when every one of its tools is ``never``."""
    names, phases = set(), {}
    for section in ("tools", "inline"):
        for key, e in (policy.get(section) or {}).items():
            name, _ = split_key(key)
            if not name or not isinstance(e, dict):
                continue
            if e.get("phase") == "never":
                names.add(name)
            if section == "tools":
                phases.setdefault(e.get("toolset"), set()).add(e.get("phase"))
    return names, {ts for ts, ph in phases.items() if ts and ph == {"never"}}


def _floor_messaging_or_kanban(name):
    """Messaging or kanban by the worker's name floor (``timely_agent.policy``)."""
    if not _WORKER_POLICY:
        worker_floor_blocks("")
    mod = _WORKER_POLICY[0]
    return mod.is_messaging(name) or name.startswith("kanban_")


def deny_reasons(folder, policy):
    """Why a skill folder is Hermes-self or needs a tool Timely never offers (plan 9.2), [] when
    neither. Read from every text file of the folder:

    - ``hermes-cli:<command>``: it runs ``hermes <command>`` (Hermes operating itself), except the
      mention-only commands in ``HERMES_CLI_MENTION_ONLY``
    - ``home-path``: it names a literal ``~/.hermes`` path (the host user's own Hermes home)
    - ``needs-toolset:<ts>`` / ``needs-tool:<name>``: its frontmatter requires a toolset or tool
      Timely never offers (every tool ``phase: never``)
    - ``session-platforms``: its frontmatter scopes it to messaging-platform sessions (decision 6)
    - ``uses-tool:<name>``: its text names a messaging or kanban tool (the worker's name floor) that
      Hermes registers and tools.yaml marks ``never``; a word that only looks like one
      (``matrix_rank``, ``signal_quality``) or a tool Hermes no longer has is not a use
    """
    never_names, never_sets = never_tools(policy)
    cli, home, conds, tools = set(), False, {}, set()
    for fname, text in _skill_texts(folder):
        cli.update(m for m in HERMES_CLI_RE.findall(text) if m in HERMES_CLI_SUBCOMMANDS)
        home = home or bool(HOME_PATH_RE.search(text))
        if fname == "SKILL.md":
            conds = frontmatter_conditions(text)
        tools.update(t for t in _TOOL_TOKEN_RE.findall(text) if t in never_names and _floor_messaging_or_kanban(t))
    reasons = [f"hermes-cli:{c}" for c in sorted(cli - HERMES_CLI_MENTION_ONLY)]
    if home:
        reasons.append("home-path")
    reasons += [f"needs-toolset:{ts}" for ts in sorted(set(conds.get("requires_toolsets", [])) & never_sets)]
    reasons += [f"needs-tool:{t}" for t in sorted(set(conds.get("requires_tools", [])) & never_names)]
    if conds.get("session_platforms"):
        reasons.append("session-platforms")
    reasons += [f"uses-tool:{t}" for t in sorted(tools)]
    return reasons


def denied_document(trees, hermes_dir, upstream, policy):
    """skills-denied.json: every bundled and optional skill with a deny reason (plan 9.2)."""
    doc = {"version": 1, "upstream": upstream,
           "about": "Hermes-self skills (they run `hermes <command>` or name a literal ~/.hermes path) and skills "
                    "that need a tool Timely never offers (messaging, kanban). Bundled ones are left out of every "
                    "account's seed tree; optional ones are never offered. Regenerate: " + REGEN,
           "mention_only_commands": sorted(HERMES_CLI_MENTION_ONLY),
           "skills": {}}
    for rel in trees:
        reasons = deny_reasons(os.path.join(hermes_dir, rel), policy)
        if reasons:
            doc["skills"][rel] = {"reasons": reasons}
    return doc


def check_denied(reviewed, denied):
    """A denied bundled skill is ``default: off`` and a denied optional skill is not offered."""
    msgs = []
    entries = (reviewed or {}).get("skills") if isinstance(reviewed, dict) else None
    skills = (denied or {}).get("skills") if isinstance(denied, dict) else None
    if not isinstance(denied, dict) or denied.get("version") != 1 or not isinstance(skills, dict):
        return [f"{SKILLS_DENIED}: version must be 1 and `skills` an object (generate it with `{REGEN}`)"]
    if not isinstance(entries, dict):
        return msgs
    for rel, d in sorted(skills.items()):
        e = entries.get(rel)
        if not isinstance(e, dict):
            continue  # check_skills reports a missing entry
        why = ", ".join((d or {}).get("reasons") or []) or "denied"
        if rel.startswith("skills/") and e.get("default") != "off":
            msgs.append(f"bundled skill {rel} is denied ({why}) but {SKILLS_REVIEWED} has default "
                        f"{e.get('default')!r}: set default \"off\" (it is never seeded)")
        if not rel.startswith("skills/") and e.get("offered") is not False:
            msgs.append(f"optional skill {rel} is denied ({why}) but {SKILLS_REVIEWED} offers it: set offered false")
    return msgs


def check_skills(reviewed, trees, runtime_skills=None):
    """Every bundled skill and every offered optional skill matches its reviewed tree (9.3)."""
    msgs = []
    entries = reviewed.get("skills") if isinstance(reviewed, dict) else None
    if not isinstance(reviewed, dict) or reviewed.get("version") != 1:
        msgs.append("skills-reviewed.json: version must be 1")
    if not isinstance(entries, dict):
        return msgs + ["skills-reviewed.json: `skills` must be an object"]
    hint = "make hermes-skills-review NAME=<skill> (or python3 -I scripts/hermes-sync/check_sync.py --review-skills <folder>)"
    for rel, tree in trees.items():
        e = entries.get(rel)
        bundled = rel.startswith("skills/")
        if e is None:
            kind = "bundled" if bundled else "optional"
            msgs.append(f"new {kind} skill {rel} has no entry in {SKILLS_REVIEWED}: read it, then {hint}; "
                        f"it stays out of the seed tree and off in every account until then")
            continue
        if not isinstance(e, dict) or not TREE_RE.match(str(e.get("tree", ""))):
            msgs.append(f"{SKILLS_REVIEWED} {rel}: needs a git tree id in `tree`")
            continue
        if bundled:
            if e.get("default") not in ("on", "off"):
                msgs.append(f"{SKILLS_REVIEWED} {rel}: bundled skills need default \"on\" or \"off\"")
            if e.get("tree") != tree:
                msgs.append(f"bundled skill {rel} changed upstream ({e.get('tree')} -> {tree}): read "
                            f"`git diff {e.get('tree')} {tree}`, then {hint}")
        else:
            if not isinstance(e.get("offered"), bool):
                msgs.append(f"{SKILLS_REVIEWED} {rel}: optional skills need offered true or false")
            elif e["offered"] and e.get("tree") != tree:
                msgs.append(f"optional skill {rel} (offered in Settings) changed upstream ({e.get('tree')} -> {tree}): "
                            f"read the diff, then {hint}")
    for rel in sorted(set(entries) - set(trees)):
        msgs.append(f"{SKILLS_REVIEWED} lists {rel}, which is not a skill in the copy any more: remove it")
    if runtime_skills is not None:
        static = {rel for rel in trees if rel.startswith("skills/")}
        live = set(runtime_skills.values())
        for rel in sorted(live - static):
            msgs.append(f"Hermes discovers bundled skill {rel} but the static scan does not (check SKILL.md layout)")
        for rel in sorted(static - live):
            msgs.append(f"bundled folder {rel} has a SKILL.md that Hermes' skills_sync does not discover "
                        f"(excluded path?); review it")
    return msgs


def review_skills(reviewed, trees, targets, everything=False):
    """Record the current tree for the named skill folders (or all); new entries start off/unoffered."""
    entries = reviewed.setdefault("skills", {})
    reviewed.setdefault("version", 1)
    chosen = sorted(trees) if everything else []
    for t in targets:
        hits = [rel for rel in trees if rel == t or rel.rsplit("/", 1)[-1] == t]
        if not hits:
            raise SystemExit(f"no skill folder matches {t!r}")
        chosen += hits
    for rel in sorted(set(chosen)):
        e = entries.setdefault(rel, {})
        e["tree"] = trees[rel]
        if rel.startswith("skills/"):
            e.setdefault("default", "off")
        else:
            e.setdefault("offered", False)
    reviewed["skills"] = dict(sorted(entries.items()))
    return sorted(set(chosen))


# ---------------------------------------------------------------- skill-body.yaml
def chat_gated_tokens(policy):
    """Names of every tool whose chat policy is approve or block (plan 9b.2 skill-body rule (a))."""
    names = set()
    for section in ("tools", "inline"):
        for key, e in (policy.get(section) or {}).items():
            name, _ = split_key(key)
            if name and isinstance(e, dict) and e.get("chat") in ("approve", "block"):
                names.add(name)
    return sorted(names)


def check_skill_body(body, policy):
    msgs = []
    if not isinstance(body, dict) or body.get("version") != 1:
        return ["skill-body.yaml: version must be 1"]
    tokens = body.get("tool_tokens")
    want = chat_gated_tokens(policy)
    if tokens != want:
        missing = sorted(set(want) - set(tokens or []))
        extra = sorted(set(tokens or []) - set(want))
        msgs.append(f"{SKILL_BODY} tool_tokens do not match tools.yaml (missing {missing}, extra {extra}): "
                    f"regenerate with `{REGEN}`")
    patterns = body.get("authority_patterns")
    if not isinstance(patterns, list) or not patterns:
        msgs.append(f"{SKILL_BODY}: authority_patterns must be a non-empty list")
    else:
        for p in patterns:
            try:
                re.compile(str(p), re.IGNORECASE)
            except re.error as exc:
                msgs.append(f"{SKILL_BODY}: authority pattern {p!r} does not compile: {exc}")
    return msgs


def render_tokens(text, tokens):
    """Replace the generated tool_tokens block of skill-body.yaml, keeping everything else."""
    start, end = text.find(GEN_BEGIN), text.find(GEN_END)
    if start < 0 or end < start:
        raise SystemExit(f"{SKILL_BODY}: generated block markers are missing")
    line_end = text.index("\n", start) + 1
    block = "tool_tokens:\n" + "".join(f"  - {t}\n" for t in tokens)
    return text[:line_end] + block + text[end:]


# ---------------------------------------------------------------- tags.json
def check_tags(tags, upstream):
    tag, commit = upstream.get("tag"), upstream.get("commit")
    entry = tags.get(tag) if isinstance(tags, dict) else None
    if not entry:
        return [f"{check_lib.SYNC_DIR}/tags.json has no entry for the imported tag {tag}"]
    if entry.get("commit") != commit:
        return [f"{check_lib.SYNC_DIR}/tags.json records {tag} at {entry.get('commit')}, but the copy came from {commit}"]
    return []


# ---------------------------------------------------------------- messaging platform env (decision 6)
GO_ENV = "apps/api/internal/agenthost/env.go"
WORKER_ENV = check_lib.AGENT_DIR + "/timely_agent/env_check.py"
# Names a platform manifest lists that are no platform's credential (google_chat reads the
# shared Google Cloud project id).
PLATFORM_ENV_SHARED = {"GOOGLE_CLOUD_PROJECT"}
_KIND_PLATFORM = re.compile(r"(?m)^kind:\s*platform\s*$")
_ENV_ENTRY = re.compile(r"(?m)^\s*-\s*name:\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)")


def platform_env_names(hermes_dir):
    """``{manifest folder: [env names]}`` for every ``kind: platform`` plugin manifest (the
    ``- name:`` entries of its requires_env/optional_env lists)."""
    root = os.path.join(hermes_dir, "plugins")
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        if "plugin.yaml" not in files:
            continue
        with open(os.path.join(dirpath, "plugin.yaml"), encoding="utf-8") as fh:
            text = fh.read()
        if _KIND_PLATFORM.search(text):
            out[os.path.relpath(dirpath, root).replace(os.sep, "/")] = sorted(set(_ENV_ENTRY.findall(text)))
    return dict(sorted(out.items()))


def go_denied(go_source):
    """A ``Denied(name)`` reading Go's ``deniedPrefixes`` and ``deniedNames`` from env.go."""
    def block(var):
        m = re.search(var + r"\s*=\s*(?:\[\]string|map\[string\]bool)\s*\{(.*?)\n\t\}", go_source, re.S)
        if not m:
            raise ValueError(f"{GO_ENV}: cannot find {var}")
        body = re.sub(r"//[^\n]*", "", m.group(1))
        return re.findall(r'"([^"]+)"', body)
    prefixes, names = tuple(block("deniedPrefixes")), set(block("deniedNames"))
    return lambda name: name in names or name.startswith(prefixes)


def worker_forbidden():
    import importlib.util
    spec = importlib.util.spec_from_file_location("_timely_env_check", check_lib.path(WORKER_ENV))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._is_forbidden


def check_platform_env(platforms, go_is_denied, worker_is_forbidden):
    """Every env name a messaging platform reads is refused by Go (never a tool key) and by the
    worker (refuses to start), so a platform added upstream cannot reach terminal children."""
    msgs = []
    for folder, names in platforms.items():
        for name in names:
            if name in PLATFORM_ENV_SHARED:
                continue
            missing = [where for where, ok in ((GO_ENV + " deniedPrefixes/deniedNames", go_is_denied(name)),
                                               (WORKER_ENV + " FORBIDDEN_PREFIXES", worker_is_forbidden(name)))
                       if not ok]
            if missing:
                msgs.append(f"platform plugin {folder} reads {name}, which " + " and ".join(missing)
                            + " let through: add its prefix to both lists (decision 6)")
    return msgs

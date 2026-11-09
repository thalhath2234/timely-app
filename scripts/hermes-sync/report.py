#!/usr/bin/env python3
"""Upstream-change report between two Hermes snapshot commits (plan section 10.3).

Usage (called by scripts/sync-hermes.sh; stdlib only, run with python3 -I):
  report.py --repo <timely repo> --old <snapshot or ''> --new <snapshot> --head <rev>
            --prefix apps/agent/hermes --sync-dir apps/agent/.hermes-sync [--verify <json>]

Reads git objects only (no checkout). Writes Markdown to stdout; it is also the sync PR body.
Static scans are labelled as such: the authoritative tool, skill and seam dumps come from
`make hermes-tools-dump` and are compared by `make hermes-sync-check`.

Hash conventions shared with apps/agent/.hermes-sync files:
  skill tree hash   the git tree id of the skill folder in the snapshot
                    (`git rev-parse <snapshot>:apps/agent/hermes/skills/<path>`)
  seam source hash  sha256 of the definition's exact source text (ast.get_source_segment)
"""
import argparse
import ast
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib

MESSAGING_HINT = re.compile(r"messag|send_|platform|telegram|discord|slack|whatsapp|signal|sms|email|a2a|kanban|desktop_ui")
DIFF_LINES_PER_SKILL = 300

# Seams Timely relies on (plan 4.4 and 10.3 item 8): (label, file hint, qualname).
# qualname "Class.*" records every public method of the class; "module:NAME" a module-level assignment.
SEAMS = [
    ("AIAgent constructor", "run_agent.py", "AIAgent.__init__"),
    ("AIAgent passthrough params", "agent/agent_init_params.py", "module:_PASSTHROUGH_PARAMS"),
    ("AIAgent callback params", "agent/agent_init_params.py", "module:_CALLBACK_PARAMS"),
    ("AIAgent gateway identity params", "agent/agent_init_params.py", "module:_GATEWAY_IDENTITY_PARAMS"),
    ("run_conversation", "agent/conversation_loop.py", "run_conversation"),
    ("pre_tool_call directive", "hermes_cli/plugins.py", "get_pre_tool_call_directive"),
    ("pre_tool_call block message", "hermes_cli/plugins.py", "get_pre_tool_call_block_message"),
    ("pre_tool_call dispatch", "hermes_cli/plugins.py", "_dispatch_pre_tool_call_hooks"),
    ("plugin register_tool (override rules)", "hermes_cli/plugins.py", "PluginContext.register_tool"),
    ("approval: register_gateway_notify", "tools/approval.py", "register_gateway_notify"),
    ("approval: resolve_gateway_approval", "tools/approval.py", "resolve_gateway_approval"),
    ("approval: set_current_session_key", "tools/approval_context.py", "set_current_session_key"),
    ("approval: set_session_vars", "gateway/session_context.py", "set_session_vars"),
    ("write approval: stage_write", "tools/write_approval.py", "stage_write"),
    ("write approval: list_pending", "tools/write_approval.py", "list_pending"),
    ("write approval: get_pending", "tools/write_approval.py", "get_pending"),
    ("write approval: discard_pending", "tools/write_approval.py", "discard_pending"),
    ("write approval: evaluate_gate", "tools/write_approval.py", "evaluate_gate"),
    ("write approval: write_approval_enabled", "tools/write_approval.py", "write_approval_enabled"),
    ("skill ledger: set_ledger_actor", "tools/skill_ledger.py", "set_ledger_actor"),
    ("skill ledger: ledger_enabled", "tools/skill_ledger.py", "ledger_enabled"),
    ("skills_sync: sync_skills", "tools/skills_sync.py", "sync_skills"),
    ("skills_sync: dir_hash", "tools/skills_sync.py", "dir_hash"),
    ("SessionDB methods", "hermes_state.py", "SessionDB.*"),
    ("background review", "agent/background_review.py", "spawn_background_review_thread"),
    ("curator", "agent/curator.py", "run_curator_review"),
    ("cron: use_cron_store", "cron/jobs.py", "use_cron_store"),
    ("is_external_skill_path", "agent/skill_utils.py", "is_external_skill_path"),
    ("_find_skill search order", "tools/skill_manager_tool.py", "_find_skill"),
]
ITERS_RESET = "_iters_since_skill = 0"

# The report covers every seam the check compares: the list above (kept literal, a unit test pins it
# to check_seams.REPORT_SEAMS) plus the worker-integration seams check_seams.py adds.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_lib  # noqa: E402
import check_seams  # noqa: E402

ALL_SEAMS = SEAMS + check_seams.TIMELY_SEAMS


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--old", default="")
    ap.add_argument("--new", required=True)
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--sync-dir", required=True)
    ap.add_argument("--verify")
    return ap.parse_args()


A = parse_args()
PREFIX = A.prefix.strip("/")


def git(*args, binary=False, check=True):
    res = subprocess.run(["git", "-C", A.repo, *args], capture_output=True)
    if check and res.returncode:
        raise SystemExit(f"report.py: git {' '.join(args[:3])}: {res.stderr.decode(errors='replace').strip()}")
    return res.stdout if binary else res.stdout.decode("utf-8", "replace")


def ls(commit, sub=PREFIX):
    if not commit:
        return {}
    files = {}
    for entry in git("ls-tree", "-r", "-z", commit, "--", sub).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            files[path[len(PREFIX) + 1:] if path.startswith(PREFIX + "/") else path] = meta.split()[2]
    return files


_blobs = {}
_batch = None


def blob(sha):
    """Blob bytes through one long-lived `git cat-file --batch` process."""
    global _batch
    if sha not in _blobs:
        if _batch is None:
            _batch = subprocess.Popen(["git", "-C", A.repo, "cat-file", "--batch"],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        _batch.stdin.write(sha.encode() + b"\n")
        _batch.stdin.flush()
        header = _batch.stdout.readline().split()
        if len(header) < 3:
            raise SystemExit(f"report.py: cannot read blob {sha}")
        data = _batch.stdout.read(int(header[2]))
        _batch.stdout.read(1)
        _blobs[sha] = data
    return _blobs[sha]


def show(rev, path):
    res = subprocess.run(["git", "-C", A.repo, "show", f"{rev}:{path}"], capture_output=True)
    return res.stdout.decode("utf-8", "replace") if res.returncode == 0 else None


def tree_id(commit, path):
    res = subprocess.run(["git", "-C", A.repo, "rev-parse", "-q", "--verify", f"{commit}:{PREFIX}/{path}"],
                         capture_output=True, text=True)
    return res.stdout.strip() if res.returncode == 0 else ""


def diff(old, new):
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(k for k in set(old) & set(new) if old[k] != new[k])
    return added, removed, changed


def names(items, limit=60, fmt="`{}`"):
    items = list(items)
    if not items:
        return "none"
    shown = ", ".join(fmt.format(i) for i in items[:limit])
    return shown + (f" ... (+{len(items) - limit} more)" if len(items) > limit else "")


def is_test(path):
    return "/tests/" in f"/{path}" or path.rsplit("/", 1)[-1].startswith("test_")


# ---------------------------------------------------------------- tools (static AST scan)
def tools(files):
    found = {}
    for path, sha in files.items():
        if not path.endswith(".py") or not path.startswith(("tools/", "plugins/")) or is_test(path):
            continue
        src = blob(sha)
        if b"register" not in src:
            continue
        try:
            text = src.decode("utf-8")
            tree = ast.parse(text)
        except (SyntaxError, UnicodeDecodeError, ValueError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fname = getattr(node.func, "attr", getattr(node.func, "id", ""))
            if fname not in ("register", "register_tool"):
                continue
            kw = {k.arg: k.value for k in node.keywords}
            name = kw.get("name")
            if isinstance(name, ast.Constant) and isinstance(name.value, str) and "schema" in kw:
                ts = kw.get("toolset")
                found[name.value] = {"file": path, "sha": sha, "toolset": getattr(ts, "value", "?"),
                                     "call": ast.get_source_segment(text, node) or ""}
    return found


# ---------------------------------------------------------------- skills
def skill_dirs(files, root):
    return sorted(p[: -len("/SKILL.md")] for p in files if p.startswith(root + "/") and p.endswith("/SKILL.md"))


def frontmatter(text):
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    return text[3:end].strip("\n") if end > 0 else ""


def skills_section(of, nf, out):
    reviewed_raw = show(A.head, f"{A.sync_dir}/policy/skills-reviewed.json")
    reviewed = {}
    if reviewed_raw:
        try:
            data = json.loads(reviewed_raw)
            data = data.get("skills", data) if isinstance(data, dict) else {}
            for k, v in data.items():
                reviewed[k] = v.get("tree") if isinstance(v, dict) else v
        except json.JSONDecodeError:
            out.append("- **skills-reviewed.json does not parse**")
    needs_review = []
    for root, label in (("skills", "Bundled"), ("optional-skills", "Optional")):
        old_dirs, new_dirs = skill_dirs(of, root), skill_dirs(nf, root)
        o = {d: tree_id(A.old, d) for d in old_dirs} if A.old else {}
        n = {d: tree_id(A.new, d) for d in new_dirs}
        added, removed, changed = diff(o, n)
        out.append(f"\n### {label} skills ({len(n)} at this tag)\n")
        out.append(f"- added: {names(added)}")
        out.append(f"- removed: {names(removed)}")
        out.append(f"- changed: {names(changed)}")
        for d in changed:
            fo = frontmatter(blob(of[d + "/SKILL.md"]).decode("utf-8", "replace"))
            fn = frontmatter(blob(nf[d + "/SKILL.md"]).decode("utf-8", "replace"))
            if fo != fn:
                udiff = "\n".join(difflib.unified_diff(fo.splitlines(), fn.splitlines(), "old", "new", lineterm=""))
                out.append(f"\n<details><summary>{d}: frontmatter changed</summary>\n\n```diff\n{udiff}\n```\n</details>")
        if root == "skills":
            for d in changed:
                text = git("diff", A.old, A.new, "--", f"{PREFIX}/{d}")
                lines = text.splitlines()
                more = f"\n... {len(lines) - DIFF_LINES_PER_SKILL} more lines: git diff {A.old[:12]} {A.new[:12]} -- {PREFIX}/{d}" \
                    if len(lines) > DIFF_LINES_PER_SKILL else ""
                body = "\n".join(lines[:DIFF_LINES_PER_SKILL]).replace("```", "` ` `")
                out.append(f"\n<details><summary>{d}: full diff</summary>\n\n```diff\n{body}{more}\n```\n</details>")
        for d, h in n.items():
            if reviewed.get(d) != h:
                needs_review.append(d)
    out.append("\n### Optional MCP servers\n")
    def mcps(files):
        res = {}
        for p, sha in files.items():
            parts = p.split("/")
            if len(parts) == 3 and parts[0] == "optional-mcps" and parts[2] == "manifest.yaml":
                text = blob(sha).decode("utf-8", "replace")
                local = bool(re.search(r"^\s*command:", text, re.M) or re.search(r"type:\s*stdio", text))
                res[parts[1]] = (sha, local)
        return res
    om, nm = mcps(of), mcps(nf)
    added, removed, changed = diff({k: v[0] for k, v in om.items()}, {k: v[0] for k, v in nm.items()})
    out.append(f"- added: {names(added, fmt='`{}`') if added else 'none'}")
    local_new = [k for k in nm if nm[k][1] and not om.get(k, (None, False))[1]]
    out.append(f"- **runs a local command (new or newly)**: {names(local_new)}")
    out.append(f"- removed: {names(removed)}")
    out.append(f"- manifest changed: {names(changed)}")

    out.append("\n### Timely overrides whose upstream changed\n")
    overrides = sorted({p.split("/")[4] for p in ls(A.head, "apps/agent/skills/overrides") if p.count("/") >= 5})
    hits = []
    for name in overrides:
        for d in skill_dirs(nf, "skills") + skill_dirs(nf, "optional-skills"):
            if d.rsplit("/", 1)[-1] == name and A.old and tree_id(A.old, d) != tree_id(A.new, d):
                hits.append(f"{name} ({d})")
    out.append(f"- overrides: {names(overrides)}; upstream changed: {names(hits, fmt='{}')}")

    out.append("\n### Skills needing review\n")
    if not reviewed_raw:
        out.append(f"- `{A.sync_dir}/policy/skills-reviewed.json` is not in HEAD yet: all {len(needs_review)} bundled and optional skill trees are unreviewed.")
    else:
        out.append(f"- {len(needs_review)} skill trees differ from skills-reviewed.json: {names(needs_review)}")
        out.append("- review with `make hermes-skills-review NAME=<skill>`.")


# ---------------------------------------------------------------- dependencies
def deps(files):
    if "pyproject.toml" not in files:
        return {}
    data = tomllib.loads(blob(files["pyproject.toml"]).decode())
    out = {}
    groups = {"": data.get("project", {}).get("dependencies", []),
              **{f"[{k}]": v for k, v in data.get("project", {}).get("optional-dependencies", {}).items()}}
    for group, reqs in groups.items():
        for r in reqs:
            name = re.split(r"[\s;\[<>=!~@]", r.strip(), maxsplit=1)[0].lower()
            out.setdefault(f"{group}{name}", set()).add(r.strip())
    return {k: " | ".join(sorted(v)) for k, v in out.items()}


def lock_keys(data):
    """``[(key, package)]`` for every ``[[package]]`` of a parsed uv.lock. The key is the name, or,
    for a name uv forks per platform (psutil: PyPI for Linux and Windows, git for Android), the
    name and its ``resolution-markers``, so each entry is diffed on its own instead of the last
    one hiding the others."""
    pkgs = data.get("package", [])
    counts = {}
    for p in pkgs:
        counts[p["name"]] = counts.get(p["name"], 0) + 1
    out, seen = [], set()
    for p in pkgs:
        key = p["name"]
        if counts[key] > 1:
            markers = " or ".join(p.get("resolution-markers") or []) or "no markers"
            key = f"{key} [{markers}]"
        base, n = key, 2
        while key in seen:
            key, n = f"{base} #{n}", n + 1
        seen.add(key)
        out.append((key, p))
    return out


def lock_versions(data):
    """``{key: version}`` for every uv.lock entry (``lock_keys``)."""
    return {k: p.get("version", "?") for k, p in lock_keys(data)}


def lock(files):
    return lock_versions(lock_data(files))


def lock_sources(data):
    """``{key: {"name", "source", "sdist": url, "wheels": [urls]}}`` from a parsed uv.lock, one
    per entry (``lock_keys``): where each package comes from, which a same-version change (a git
    URL, a direct wheel, another index) would not show in the version list."""
    out = {}
    for key, p in lock_keys(data):
        sdist = p.get("sdist") or {}
        out[key] = {"name": p["name"], "source": p.get("source", {}),
                    "sdist": sdist.get("url", sdist.get("path", "")),
                    "wheels": sorted(w.get("url", w.get("path", "")) for w in p.get("wheels", []))}
    return out


def non_registry(entry):
    """True for a source that is not a package index (git, direct URL, path, editable)."""
    source = entry.get("source") or {}
    return not ("registry" in source or "virtual" in source or "editable" in source)


def source_changes(old, new):
    """Must-review lines for ``lock_sources`` maps: an entry whose source or artifact URLs
    changed, an entry that is new for a package the old lock had (its forks changed) with a source
    none of the package's old entries used, and every non-registry source that is new
    (``uv sync --frozen`` builds sdists and git sources, so it runs their build code)."""
    lines = []
    old_sources = {}
    for e in old.values():
        old_sources.setdefault(e.get("name"), []).append(e["source"])
    for key in sorted(new):
        e, o = new[key], old.get(key)
        if o is None:
            known = old_sources.get(e.get("name"))
            if known is not None and e["source"] not in known:
                lines.append(f"source of `{key}` is new for `{e.get('name')}`: "
                             f"{json.dumps(e['source'], sort_keys=True)} (was "
                             f"{', '.join(json.dumps(s, sort_keys=True) for s in known)})")
            elif non_registry(e):
                lines.append(f"new non-registry source `{key}`: {json.dumps(e['source'], sort_keys=True)}")
            continue
        if e["source"] != o["source"]:
            lines.append(f"source of `{key}` changed: {json.dumps(o['source'], sort_keys=True)} -> "
                         f"{json.dumps(e['source'], sort_keys=True)}")
        elif e["sdist"] != o["sdist"] or e["wheels"] != o["wheels"]:
            lines.append(f"artifact URLs of `{key}` changed at the same source (sdist {o['sdist'] or '-'} -> "
                         f"{e['sdist'] or '-'}, {len(o['wheels'])} -> {len(e['wheels'])} wheels)")
    return lines


def uv_settings(files):
    """``[tool.uv]`` of pyproject.toml (sources, index, override-dependencies, ...), flattened."""
    if "pyproject.toml" not in files:
        return {}
    data = tomllib.loads(blob(files["pyproject.toml"]).decode())
    return flatten(data.get("tool", {}).get("uv", {}))


def flatten(value, prefix=""):
    """``{"a.b": json}`` for every leaf of nested tables (lists and empty tables are leaves)."""
    if isinstance(value, dict) and value:
        out = {}
        for k, v in value.items():
            out.update(flatten(v, f"{prefix}.{k}" if prefix else str(k)))
        return out
    return {prefix: json.dumps(value, sort_keys=True)} if prefix else {}


def lock_data(files):
    return tomllib.loads(blob(files["uv.lock"]).decode()) if "uv.lock" in files else {}


# ---------------------------------------------------------------- config defaults and env vars
CONFIG_CODE = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from hermes_cli import config_defaults as m
out = {}
def walk(v, k):
    if isinstance(v, dict) and v:
        for n, x in v.items():
            walk(x, f"{k}.{n}" if k else str(n))
    else:
        out[k] = repr(v)
walk(m.DEFAULT_CONFIG, "")
env = sorted(getattr(m, "OPTIONAL_ENV_VARS", {}) or {})
print(json.dumps({"config": out, "env": env}))
"""


CONFIG_TIMEOUT_S = 30


def config(files):
    """DEFAULT_CONFIG and OPTIONAL_ENV_VARS of the new snapshot. This imports upstream code nobody
    has reviewed yet, so it runs with a bare environment (no developer tokens or cloud keys; HOME
    and TMPDIR in a throwaway folder) and a timeout."""
    want = [p for p in files if re.fullmatch(r"hermes_cli/(config_defaults\w*|__init__)\.py", p)]
    if "hermes_cli/config_defaults.py" not in want:
        return {}, [], "hermes_cli/config_defaults.py not found"
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(f"{d}/hermes_cli")
        os.makedirs(f"{d}/home")
        for p in want:
            with open(f"{d}/{p}", "wb") as fh:
                fh.write(blob(files[p]))
        env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": f"{d}/home", "TMPDIR": d,
               "TEMP": d, "TMP": d, "USERPROFILE": f"{d}/home"}
        if os.environ.get("SYSTEMROOT"):
            env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
        try:
            res = subprocess.run([sys.executable, "-I", "-c", CONFIG_CODE, d], capture_output=True, text=True,
                                 env=env, cwd=d, timeout=CONFIG_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {}, [], f"importing config_defaults timed out after {CONFIG_TIMEOUT_S} s"
    if res.returncode:
        return {}, [], (res.stderr.strip().splitlines() or ["unknown error"])[-1]
    data = json.loads(res.stdout)
    return data["config"], data["env"], ""


ENV_RE = re.compile(rb"""(?:getenv|environ\.get|environ\[|environ\.setdefault)\(?\s*["']([A-Z][A-Z0-9_]{2,})["']""")


def env_reads(files):
    found = set()
    for p, sha in files.items():
        if p.endswith(".py") and not is_test(p):
            found.update(m.decode() for m in ENV_RE.findall(blob(sha)))
    return found


# ---------------------------------------------------------------- seams (static)
def find_def(tree, qual):
    parts = qual.split(".")
    nodes = tree.body
    found = None
    for i, part in enumerate(parts):
        found = None
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == part:
                found = node
                break
        if found is None:
            return None
        nodes = getattr(found, "body", [])
    return found


def sig(node):
    if isinstance(node, ast.ClassDef):
        return "class " + node.name + "(" + ", ".join(ast.unparse(b) for b in node.bases) + ")"
    ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    return f"def {node.name}({ast.unparse(node.args)}){ret}"


def seam_values(files):
    """label -> {file, signature, sha256} from a static parse; missing seams are absent."""
    parsed = {}

    def parse(path):
        if path not in parsed:
            parsed[path] = None
            if path in files:
                text = blob(files[path]).decode("utf-8", "replace")
                try:
                    parsed[path] = (text, ast.parse(text))
                except SyntaxError:
                    pass
        return parsed[path]

    def locate(hint, qual):
        if parse(hint) and lookup(parse(hint), qual) is not None:
            return hint
        top = qual.split(".")[0].split(":")[-1]
        needle = re.compile(rf"^(class|def|async def) {re.escape(top)}\b|^{re.escape(top)}\s*[:=]", re.M)
        for p, sha in sorted(files.items()):
            if p.endswith(".py") and not is_test(p) and needle.search(blob(sha).decode("utf-8", "replace")):
                if parse(p) and lookup(parse(p), qual) is not None:
                    return p
        return None

    def lookup(pt, qual):
        text, tree = pt
        if qual.startswith("module:"):
            name = qual[len("module:"):]
            for node in tree.body:
                targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
                if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                    seg = ast.get_source_segment(text, node) or ""
                    return seg, seg
            return None
        if qual.endswith(".*"):
            cls = find_def(tree, qual[:-2])
            if not isinstance(cls, ast.ClassDef):
                return None
            sigs = [sig(cls)] + [sig(n) for n in cls.body
                                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_")]
            seg = ast.get_source_segment(text, cls) or ""
            return "\n".join(sigs), seg
        node = find_def(tree, qual)
        if node is None:
            return None
        return sig(node), ast.get_source_segment(text, node) or ""

    out = {}
    for label, hint, qual in ALL_SEAMS:
        path = locate(hint, qual)
        if path:
            signature, source = lookup(parse(path), qual)
            out[label] = {"file": path, "qualname": qual, "signature": signature,
                          "sha256": hashlib.sha256(source.encode()).hexdigest()}
    sites = []
    for p, sha in sorted(files.items()):
        if p.endswith(".py") and not is_test(p) and ITERS_RESET.encode() in blob(sha):
            pt = parse(p)
            for node in ast.walk(pt[1]) if pt else []:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    seg = ast.get_source_segment(pt[0], node) or ""
                    inner = [c for c in ast.walk(node) if c is not node and isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef))
                             and ITERS_RESET in (ast.get_source_segment(pt[0], c) or "")]
                    if ITERS_RESET in seg and not inner:
                        sites.append(f"{p}::{node.name}")
    out["_iters_since_skill reset sites"] = {"file": "", "qualname": "", "signature": "\n".join(sorted(sites)),
                                             "sha256": hashlib.sha256("\n".join(sorted(sites)).encode()).hexdigest()}
    return out


# ---------------------------------------------------------------- main
def name_status(a, b):
    rows = []
    for line in git("diff", "-M", "--name-status", "-z", a, b, "--", PREFIX).split("\0"):
        rows.append(line)
    rows = [r for r in rows if r]
    out, i = [], 0
    while i < len(rows):
        status = rows[i]
        if status[0] in "RC":
            out.append((status, rows[i + 1], rows[i + 2]))
            i += 3
        else:
            out.append((status, rows[i + 1], rows[i + 1]))
            i += 2
    strip = lambda p: p[len(PREFIX) + 1:]
    return [(s, strip(o), strip(n)) for s, o, n in out]


def main():
    verify = json.load(open(A.verify)) if A.verify else {}
    of, nf = ls(A.old), ls(A.new)
    meta = json.loads(blob(nf["HERMES_UPSTREAM.json"]))
    old_meta = json.loads(blob(of["HERMES_UPSTREAM.json"])) if "HERMES_UPSTREAM.json" in of else {}
    st = meta["stats"]
    out = []
    p = out.append
    p(f"# Hermes sync: {old_meta.get('tag', '(first import)')} -> {meta['tag']}\n")
    p("## 0. Upstream release and tag check\n")
    p(f"- tag `{meta['tag']}` resolves to `{meta['commit']}` (committed {meta['committed']})")
    if verify:
        p(f"- tag body commit: `{verify.get('tag_body_commit') or '(none)'}`")
        p(f"- GitHub release API target: {verify.get('release_api')}")
        p(f"- tags.json: {verify.get('tags_check')}")
        p(f"- ancestry: {verify.get('ancestry')}")
    p(f"- filter blob `{meta['filterSha1']}`; snapshot `{A.new}`; previous snapshot `{A.old or '(none)'}`")
    p(f"- copied {st['files']} files, {st['bytes'] / 1048576:.1f} MiB ({st['bytes']} bytes); "
      f"dropped by top-level dir: {json.dumps(st['dropped'])}")
    p(f"- symlinks: {names(st['symlinks'])}; case collisions: {names(st['caseCollisions'], fmt='{}')}; "
      f"gitlinks skipped: {names(st['gitlinks'])}")
    p(f"- longest path {st['longestPath']['length']} chars (`{st['longestPath']['path']}`); "
      f"paths over 200 chars: {st['longestPath']['overWindowsWarn']}")
    rows = name_status(A.old, A.new) if A.old else []
    counts = {}
    for s, _, _ in rows:
        counts[s[0]] = counts.get(s[0], 0) + 1
    p(f"- files: {json.dumps(counts) if A.old else 'all new'}")

    p("\n## 1. Tools (static, core only)\n")
    ot, nt = tools(of), tools(nf)
    added, removed, changed = diff({k: v["call"] for k, v in ot.items()}, {k: v["call"] for k, v in nt.items()})
    p(f"Static AST scan of `registry.register(name=..., schema=...)` calls in tools/ and plugins/ found {len(nt)} tools; "
      "plugins that register in loops are invisible here, so the runtime dump that `make hermes-sync-check` "
      "compares with the committed tools.json is authoritative.\n")
    p("- added: " + (", ".join(f"`{k}` ({nt[k]['toolset']}, {nt[k]['file']})" for k in added) or "none"))
    p("- removed: " + (", ".join(f"`{k}` ({ot[k]['file']})" for k in removed) or "none"))
    p(f"- registration changed: {names(changed)}")
    moved = sorted(k for k in set(ot) & set(nt) if ot[k]["file"] != nt[k]["file"])
    p("- moved: " + (", ".join(f"`{k}` {ot[k]['file']} -> {nt[k]['file']}" for k in moved) or "none"))
    impl = sorted(k for k in set(ot) & set(nt) if ot[k]["sha"] != nt[k]["sha"] and k not in changed)
    p(f"- implementation file changed: {names(impl)}")
    dump_raw = show(A.head, f"{A.sync_dir}/tools.json")
    if dump_raw:
        dump = json.loads(dump_raw)
        known = set(dump.get("tools", dump) if isinstance(dump, dict) else dump)
        p(f"- runtime dump `{A.sync_dir}/tools.json` (HEAD) lists {len(known)} tools; statically found but not in it: "
          f"{names(sorted(set(nt) - known))}. Run `make hermes-tools-dump` and commit the diff; `make hermes-sync-check` compares the live dump.")
    else:
        p(f"- runtime dump: `{A.sync_dir}/tools.json` is not in HEAD yet (written by `make hermes-tools-dump`).")

    p("\n## 2. Skills")
    skills_section(of, nf, out)

    p("\n## 3. Dependencies\n")
    od, nd = deps(of), deps(nf)
    a_, r_, c_ = diff(od, nd) if A.old else ([], [], [])
    if not A.old:
        p(f"- pyproject.toml: {len(nd)} requirements (first import, no diff)")
    for k in a_:
        p(f"- added `{nd[k]}`")
    for k in r_:
        p(f"- removed `{od[k]}`")
    for k in c_:
        p(f"- changed `{od[k]}` -> `{nd[k]}`")
    if A.old and not (a_ or r_ or c_):
        p("- pyproject.toml dependencies: no change")
    ol, nl = lock(of), lock(nf)
    a_, r_, c_ = diff(ol, nl) if A.old else ([], [], [])
    p(f"- uv.lock: {len(nl)} package entries; added {names([f'{k} {nl[k]}' for k in a_], fmt='{}')}; "
      f"removed {names(r_)}; version changed {names([f'{k} {ol[k]} -> {nl[k]}' for k in c_], fmt='{}')}")
    osrc, nsrc = (lock_sources(lock_data(of)) if A.old else {}), lock_sources(lock_data(nf))
    if A.old:
        changed = source_changes(osrc, nsrc)
        for line in changed:
            p(f"- **MUST REVIEW** uv.lock {line}")
        if not changed:
            p("- uv.lock sources and artifact URLs: no change")
    else:
        odd = sorted(n for n, e in nsrc.items() if non_registry(e))
        p(f"- uv.lock non-registry sources (git, direct URL; `uv sync --frozen` builds them): {names(odd)}")
    ou, nu = (uv_settings(of) if A.old else {}), uv_settings(nf)
    a_, r_, c_ = diff(ou, nu) if A.old else ([], [], [])
    for k in a_ + c_:
        p(f"- **MUST REVIEW** pyproject [tool.uv] `{k}` = {nu[k][:300]}" + (f" (was {ou[k][:300]})" if k in ou else ""))
    for k in r_:
        p(f"- **MUST REVIEW** pyproject [tool.uv] `{k}` removed (was {ou[k][:300]})")
    if A.old and not (a_ or r_ or c_):
        p("- pyproject [tool.uv]: no change")

    p("\n## 4. Config and environment\n")
    oc, oe, oerr = config(of) if A.old else ({}, [], "")
    nc, ne, nerr = config(nf)
    if nerr or oerr:
        p(f"- DEFAULT_CONFIG could not be read: {nerr or oerr}")
    a_, r_, c_ = diff(oc, nc)
    p(f"- DEFAULT_CONFIG: {len(nc)} flattened keys" + ("" if A.old else " (first import, no diff)"))
    if A.old:
        for k in a_:
            p(f"  - added `{k}` = {nc[k][:200]}")
        for k in r_:
            p(f"  - removed `{k}` (was {oc[k][:200]})")
        for k in c_:
            p(f"  - default changed `{k}`: {oc[k][:200]} -> {nc[k][:200]}")
        a_, r_, _ = diff({e: 1 for e in oe}, {e: 1 for e in ne})
        p(f"- OPTIONAL_ENV_VARS: added {names(a_)}; removed {names(r_)}")
        oen, nen = env_reads(of), env_reads(nf)
        p(f"- env vars read in code (static): added {names(sorted(nen - oen))}; removed {names(sorted(oen - nen))}")
    else:
        p(f"- OPTIONAL_ENV_VARS: {len(ne)} names; env vars read in code (static): {len(env_reads(nf))} names")

    p("\n## 5. New upstream top-level dirs not in the filter\n")
    new_dirs = st["newTopLevelDirs"]
    old_dirs = old_meta.get("stats", {}).get("newTopLevelDirs", [])
    p(f"- {names(new_dirs)}" + (f" (new since last sync: {names(sorted(set(new_dirs) - set(old_dirs)))})" if A.old else ""))
    if new_dirs:
        p("- add a `dir` or `skip-dir` line for each to apps/agent/.hermes-sync/filter")

    p("\n## 6. Hermes AGENTS.md files changed\n")
    agents = sorted({n for s, o, n in rows if n.endswith(("AGENTS.md", "AGENTS.hermes.md", "CLAUDE.md"))})
    p(f"- {names(agents)}" if A.old else f"- first import: {names(sorted(f for f in nf if f.endswith(('AGENTS.md', 'AGENTS.hermes.md', 'CLAUDE.md'))))}")

    # Timely's own changes are measured against the snapshot --head links to. That is --old during a
    # sync, but `make hermes-sync-report OLD=<tag> NEW=<tag>` may run with HEAD past OLD, and then
    # diffing --old against HEAD would list upstream's changes as Timely's.
    base = A.old
    if A.old:
        linked = check_lib.previous_snapshot(repo=A.repo, prefix=PREFIX, head=A.head)[0]
        base = linked or ""
    p("\n## 7. Timely-patched files that upstream also changed (expect conflicts here)\n")
    if A.old and not base:
        p(f"- skipped: `{A.head}` is not linked to a Hermes snapshot, so Timely's own changes cannot be told apart")
    elif A.old:
        timely = [r for r in name_status(base, A.head) if r[1] != "HERMES_UPSTREAM.json"]
        upstream = {o: (s, n) for s, o, n in rows}
        p(f"- Timely delta since the last snapshot ({len(timely)} files; must equal patches.md): "
          f"{names([f'{s} {o}' + (f' -> {n}' if n != o else '') for s, o, n in timely], fmt='{}')}")
        both = [f"{o} (upstream {upstream[o][0]}{' -> ' + upstream[o][1] if upstream[o][1] != o else ''})"
                for s, o, n in timely if o in upstream]
        p(f"- also changed upstream: {names(both, fmt='{}')}")
    else:
        p("- first import: no Timely changes yet")

    p("\n## 8. Seams Timely relies on (static)\n")
    os_, ns = seam_values(of) if A.old else {}, seam_values(nf)
    missing = [label for label, _, _ in ALL_SEAMS if label not in ns]
    p(f"- {len(ns)} seams found; missing: {names(missing)}")
    if A.old:
        for label in sorted(set(os_) & set(ns)):
            o, n = os_[label], ns[label]
            if o["signature"] != n["signature"]:
                p(f"- **signature changed** {label} ({n['file']}):\n  ```\n  {o['signature']}\n  ->\n  {n['signature']}\n  ```")
            elif o["sha256"] != n["sha256"]:
                p(f"- body changed: {label} ({n['file']})")
            if o["file"] != n["file"]:
                p(f"- moved: {label} {o['file']} -> {n['file']}")
        for label in sorted(set(os_) - set(ns)):
            p(f"- **gone**: {label} (was {os_[label]['file']})")
    seams_raw = show(A.head, f"{A.sync_dir}/seams.json")
    if seams_raw:
        try:
            committed = json.loads(seams_raw)
            committed = committed.get("seams", committed)
            stale = sorted(k for k, v in committed.items() if isinstance(v, dict) and k in ns
                           and v.get("sha256", v.get("source_sha256")) not in (None, ns[k]["sha256"]))
            gone = sorted(k for k, v in committed.items() if isinstance(v, dict) and k not in ns)
            p(f"- vs committed seams.json: {names(stale)} differ; recorded but not found here: {names(gone)} "
              "(`make hermes-sync-check` gives the details; regenerate with `check_sync.py --write`)")
        except (json.JSONDecodeError, AttributeError):
            p("- committed seams.json does not parse")
    else:
        p(f"- `{A.sync_dir}/seams.json` is not in HEAD yet (written by `make hermes-tools-dump`)")
    p("\n<details><summary>Seam signatures at this tag</summary>\n")
    for label, v in ns.items():
        p(f"- {label} `{v['file']}` sha256 `{v['sha256'][:16]}`")
    p("\n</details>")

    p("\n## 9. Messaging platforms and messaging tools\n")
    def platforms(files):
        res = set()
        for f in files:
            parts = f.split("/")
            if len(parts) >= 4 and parts[:2] == ["plugins", "platforms"]:
                res.add("plugins/platforms/" + parts[2])
            elif len(parts) == 3 and parts[:2] == ["gateway", "platforms"] and f.endswith(".py"):
                res.add(f)
        return res
    op, np_ = platforms(of), platforms(nf)
    p(f"- platform plugins at this tag: {len([x for x in np_ if x.startswith('plugins/')])}; "
      f"added: {names(sorted(np_ - op)) if A.old else '(first import)'}; removed: {names(sorted(op - np_)) if A.old else '-'}")
    msg_tools = sorted(k for k, v in nt.items() if MESSAGING_HINT.search(f"{k} {v['toolset']} {v['file']}"))
    p(f"- messaging, desktop_ui, kanban and a2a-like tools (static): {names(msg_tools)}; new: {names(sorted(set(msg_tools) - set(ot))) if A.old else '(first import)'}")

    p("\n## 10. Files at Timely-owned paths\n")
    outside = [f for f in git("ls-tree", "-r", "-z", "--name-only", A.new).split("\0") if f and not f.startswith(PREFIX + "/")]
    p(f"- snapshot paths outside `{PREFIX}/`: {names(outside)}")
    if A.old:
        if base:
            timely_added = {f for f in ls(A.head) if f not in ls(base)}
            p(f"- upstream now adds files Timely had added itself: {names(sorted(timely_added & (set(nf) - set(of))))}")
        else:
            p(f"- Timely-added files: skipped (`{A.head}` is not linked to a Hermes snapshot)")
    print("\n".join(out))


if __name__ == "__main__":
    main()

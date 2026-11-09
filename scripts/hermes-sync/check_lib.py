"""Shared helpers for the post-sync checks (plan section 10.4). Stdlib only; run with python3 -I.

Holds the repo paths, a git wrapper, the canonical schema hash and a strict YAML subset loader
for the policy files under apps/agent/.hermes-sync/policy/. The subset is plain YAML that any YAML
loader reads the same way; the loader refuses everything outside it, so the check never reads a
policy file differently from the worker (which will use PyYAML).
"""
import hashlib
import json
import os
import re
import subprocess

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENT_DIR = "apps/agent"
PREFIX = "apps/agent/hermes"
SYNC_DIR = "apps/agent/.hermes-sync"
POLICY_DIR = SYNC_DIR + "/policy"


def path(rel):
    return os.path.join(REPO_ROOT, rel)


def git(*args, repo=None, check=True):
    res = subprocess.run(["git", "-C", repo or REPO_ROOT, *args], capture_output=True, text=True)
    if check and res.returncode:
        raise RuntimeError(f"git {' '.join(args[:3])}: {res.stderr.strip()}")
    return res.stdout


def snapshot_commit(repo=None):
    """The last `hermes: snapshot` commit in HEAD's history (same query as check.sh)."""
    out = git("log", "-1", "--format=%H", "--all-match", "--grep=^hermes: snapshot ",
              "--grep=^Hermes-Commit: ", "HEAD", repo=repo).strip()
    return out or None


def _is_snapshot_message(commit, repo=None):
    msg = git("log", "-1", "--format=%B", commit, repo=repo)
    return msg.startswith("hermes: snapshot ") and re.search(r"(?m)^Hermes-Commit: ", msg) is not None


def snapshot_problems(commit, repo=None, prefix=PREFIX):
    """Why `commit` is not a real snapshot commit, or [] when it is.

    A snapshot holds only `prefix/` and its parents are snapshots too (the first has none). A
    rebase replays a snapshot onto a Timely commit, keeping its message and trailers but giving
    it the whole repo's tree; the next sync would then merge a prefix-only tree against it and
    delete every Timely file. A squash leaves no snapshot at all (the callers' other check)."""
    problems = []
    if not _is_snapshot_message(commit, repo):
        problems.append(f"{commit[:12]} is not a `hermes: snapshot` commit with a Hermes-Commit trailer")
    outside = [p for p in git("ls-tree", "-r", "--name-only", commit, repo=repo).splitlines()
               if p and not p.startswith(prefix + "/")]
    if outside:
        problems.append(f"snapshot {commit[:12]} holds {len(outside)} files outside {prefix}/ "
                        f"(e.g. {', '.join(outside[:3])}); a rebase replayed it onto a Timely commit")
    parents = git("rev-list", "--parents", "-n1", commit, repo=repo).split()[1:]
    for parent in parents:
        if not _is_snapshot_message(parent, repo):
            problems.append(f"snapshot {commit[:12]} has parent {parent[:12]}, which is not a snapshot commit")
    return problems


RELINK_HELP = ("Recovery: find the real snapshot commit (the second parent of the `hermes: sync` merge "
               "on the branch that imported it, or `git rev-parse refs/hermes/vendor` on the machine that "
               "ran the sync), then `git merge -s ours --allow-unrelated-histories <snapshot>` and re-run.")


if __name__ == "__main__":  # `check_lib.py verify-snapshot <rev> [repo]`: used by sync-hermes.sh and check.sh
    import sys
    if len(sys.argv) not in (3, 4) or sys.argv[1] != "verify-snapshot":
        sys.exit("usage: check_lib.py verify-snapshot <rev> [repo]")
    repo_arg = sys.argv[3] if len(sys.argv) == 4 else None
    found = snapshot_problems(git("rev-parse", "--verify", sys.argv[2] + "^{commit}", repo=repo_arg).strip(),
                              repo=repo_arg)
    for line in found:
        print(line, file=sys.stderr)
    if found:
        print(RELINK_HELP, file=sys.stderr)
    sys.exit(1 if found else 0)


def schema_sha256(schema):
    """sha256 of a tool schema as canonical JSON (sorted keys, no whitespace, UTF-8).

    check_dump.py carries its own copy (it runs inside the agent interpreter); a unit test keeps
    the two identical."""
    blob = json.dumps(schema, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def read_json(rel):
    with open(path(rel), encoding="utf-8") as fh:
        return json.load(fh)


def write_json(rel, data):
    with open(path(rel), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, sort_keys=False, ensure_ascii=False)
        fh.write("\n")


# ---------------------------------------------------------------- YAML subset
class YamlError(ValueError):
    pass


_KEY = r"[A-Za-z_][A-Za-z0-9_.@:/+-]*"
_KEY_LINE = re.compile(rf"^({_KEY}):(?:[ ](.*))?$")
# Plain scalars start with a letter, `_` or `/`, so nothing reads as a number, date or sexagesimal
# in YAML 1.1; anything else is quoted (or an int written as digits).
_PLAIN = re.compile(r"^[A-Za-z_/][A-Za-z0-9_./@:+=-]*$")
_INT = re.compile(r"^(0|-?[1-9][0-9]*)$")
_AMBIGUOUS = {"y", "n", "yes", "no", "on", "off", "true", "false", "null", "~"}


def _strip_comment(line):
    """Drop a trailing `# comment` that sits outside quotes."""
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i].rstrip()
    return line.rstrip()


def _scalar(text, where):
    text = text.strip()
    if not text:
        raise YamlError(f"{where}: empty value (write '' or a nested block)")
    if text[0] == '"':
        if len(text) < 2 or text[-1] != '"':
            raise YamlError(f"{where}: unterminated double-quoted string")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise YamlError(f"{where}: bad double-quoted string ({exc.msg})") from None
    if text[0] == "'":
        if len(text) < 2 or text[-1] != "'" or "'" in text[1:-1].replace("''", ""):
            raise YamlError(f"{where}: bad single-quoted string")
        return text[1:-1].replace("''", "'")
    if text[0] == "[":
        if text[-1] != "]":
            raise YamlError(f"{where}: flow list must end with ]")
        inner = text[1:-1].strip()
        if not inner:
            return []
        items, buf, quote = [], "", None
        for ch in inner:
            if quote:
                buf += ch
                if ch == quote:
                    quote = None
            elif ch in "'\"":
                quote = ch
                buf += ch
            elif ch == ",":
                items.append(buf)
                buf = ""
            elif ch in "[]{}":
                raise YamlError(f"{where}: nested flow collections are not allowed")
            else:
                buf += ch
        items.append(buf)
        out = []
        for item in items:
            if ":" in item and item.strip()[:1] not in "'\"":
                raise YamlError(f"{where}: quote list item {item.strip()!r} (it holds a colon)")
            value = _scalar(item, where)
            if isinstance(value, list):
                raise YamlError(f"{where}: nested flow collections are not allowed")
            out.append(value)
        return out
    if text in ("true", "false"):
        return text == "true"
    if text in ("null", "~"):
        return None
    if text.lower() in _AMBIGUOUS:
        raise YamlError(f"{where}: {text!r} reads as a boolean in YAML 1.1; quote it")
    if _INT.match(text):
        return int(text)
    if not _PLAIN.match(text) or text.endswith(":"):
        raise YamlError(f"{where}: {text!r} must be quoted")
    return text


def yaml_load(text, name="<yaml>"):
    """Parse the subset: nested block mappings, block lists of scalars, flow lists of scalars,
    plain/quoted scalars, comments. No anchors, tags, multi-line strings or tabs."""
    rows = []
    for no, raw in enumerate(text.splitlines(), 1):
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise YamlError(f"{name}:{no}: tabs in indentation")
        if raw.strip() in ("---", "...") and not raw.startswith(" "):
            raise YamlError(f"{name}:{no}: document markers are not allowed")
        line = _strip_comment(raw)
        if line.strip():
            rows.append((no, len(line) - len(line.lstrip(" ")), line.strip()))
    pos = 0

    def block(indent):
        nonlocal pos
        if pos >= len(rows):
            return None
        no, ind, body = rows[pos]
        if ind != indent:
            raise YamlError(f"{name}:{no}: expected indent {indent}, got {ind}")
        if body.startswith("- ") or body == "-":
            out = []
            while pos < len(rows) and rows[pos][1] == indent and (rows[pos][2].startswith("- ") or rows[pos][2] == "-"):
                no, _, body = rows[pos]
                item = body[2:].strip()
                if not item or _KEY_LINE.match(item):
                    raise YamlError(f"{name}:{no}: list items must be scalars")
                value = _scalar(item, f"{name}:{no}")
                if isinstance(value, list):
                    raise YamlError(f"{name}:{no}: nested lists are not allowed")
                out.append(value)
                pos += 1
            return out
        out = {}
        while pos < len(rows) and rows[pos][1] == indent:
            no, _, body = rows[pos]
            m = _KEY_LINE.match(body)
            if not m:
                raise YamlError(f"{name}:{no}: expected `key: value`, got {body!r}")
            key, value = m.group(1), m.group(2)
            if key.lower() in _AMBIGUOUS or key.endswith(":"):
                raise YamlError(f"{name}:{no}: key {key!r} is ambiguous")
            if key in out:
                raise YamlError(f"{name}:{no}: duplicate key {key!r}")
            pos += 1
            if value is None or not value.strip():
                if pos < len(rows) and rows[pos][1] > indent:
                    out[key] = block(rows[pos][1])
                else:
                    raise YamlError(f"{name}:{no}: {key!r} has no value")
            else:
                out[key] = _scalar(value, f"{name}:{no}")
        if pos < len(rows) and rows[pos][1] > indent:
            raise YamlError(f"{name}:{rows[pos][0]}: unexpected indent")
        return out

    if not rows:
        return {}
    result = block(rows[0][1])
    if rows[0][1] != 0:
        raise YamlError(f"{name}:{rows[0][0]}: top level must not be indented")
    if pos != len(rows):
        raise YamlError(f"{name}:{rows[pos][0]}: unexpected dedent or content")
    return result


def yaml_scalar(value):
    """Render one scalar so yaml_load (and any YAML loader) reads it back unchanged."""
    if value is True or value is False:
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    if _PLAIN.match(text) and ":" not in text and text.lower() not in _AMBIGUOUS:
        return text
    return json.dumps(text, ensure_ascii=False)


def read_yaml(rel):
    with open(path(rel), encoding="utf-8") as fh:
        return yaml_load(fh.read(), rel)

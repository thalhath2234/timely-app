#!/usr/bin/env python3
"""Build the git tree of one filtered Hermes snapshot inside the Timely repo, with plumbing only.

Usage (called by scripts/sync-hermes.sh; stdlib only, run with python3 -I):
  snapshot.py --cache <bare upstream repo> --repo <timely repo> --commit <sha> --tag <tag>
              --committed <iso date> --filter <file> --filter-sha1 <blob sha> --prefix apps/agent/hermes
              --index <temp index file> --url <upstream url> --stats-out <file>

Steps: `ls-tree -r -z` the upstream commit in the cache, apply the filter, copy the blobs the
Timely repo lacks (pack-objects | index-pack, byte-identical, no checkout, so Hermes' own
.gitignore cannot drop tracked files), add HERMES_UPSTREAM.json, `update-index --index-info` into
a temp index and `write-tree`. Prints the tree id on stdout.

Filter syntax (apps/agent/.hermes-sync/filter):
  dir <name>            copy this top-level directory
  skip-dir <name>       a top-level directory left out on purpose
  skip <glob>           drop matching upstream paths (fnmatch on the full path, or any parent)
  keep <path>           copy this path (file or folder) even if a skip or an unlisted dir drops it
  rename <from> <to>    store upstream <from> at <to> (exact path)
Root files are copied unless a `skip` matches. A top-level directory in neither `dir` nor
`skip-dir` is left out and reported as new.
"""
import argparse
import fnmatch
import json
import os
import subprocess
import sys

RECORD = "HERMES_UPSTREAM.json"
# Longest path Windows tooling handles without long-path support, measured from the repo root.
WINDOWS_PATH_WARN = 200


def die(msg):
    print(f"snapshot.py: {msg}", file=sys.stderr)
    sys.exit(1)


def git(git_dir, *args, data=None, env=None):
    res = subprocess.run(["git", "--git-dir", git_dir, *args], input=data, capture_output=True, env=env)
    if res.returncode:
        die(f"git {' '.join(args[:3])} failed: {res.stderr.decode(errors='replace').strip()}")
    return res.stdout


def load_filter(path):
    rules = {"dir": set(), "skip-dir": set(), "skip": [], "keep": [], "rename": {}}
    with open(path, encoding="utf-8") as fh:
        for n, raw in enumerate(fh, 1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            kind, *args = line.split()
            want = 2 if kind == "rename" else 1
            if kind not in rules or len(args) != want:
                die(f"{path}:{n}: cannot parse {raw.strip()!r}")
            if kind == "rename":
                rules["rename"][args[0]] = args[1]
            elif kind in ("skip", "keep"):
                rules[kind].append(args[0])
            else:
                rules[kind].add(args[0])
    return rules


def matches(path, globs):
    parts = path.split("/")
    candidates = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    return any(fnmatch.fnmatchcase(c, g) for g in globs for c in candidates)


def kept(path, keeps):
    return any(path == k or path.startswith(k.rstrip("/") + "/") for k in keeps)


def select(entries, rules):
    """entries: (mode, type, sha, path). Returns (copied, stats)."""
    copied, dropped, new_dirs, gitlinks = [], {}, set(), []
    for mode, typ, sha, path in entries:
        top = path.split("/", 1)[0] if "/" in path else "(root)"
        if typ == "commit":
            gitlinks.append(path)
            continue
        keep = kept(path, rules["keep"])
        if top != "(root)" and top not in rules["dir"] and not keep:
            if top not in rules["skip-dir"]:
                new_dirs.add(top)
            dropped[top] = dropped.get(top, 0) + 1
            continue
        if not keep and matches(path, rules["skip"]):
            dropped[top] = dropped.get(top, 0) + 1
            continue
        copied.append((mode, sha, rules["rename"].get(path, path)))
    return copied, {"dropped": dict(sorted(dropped.items())), "newTopLevelDirs": sorted(new_dirs),
                    "gitlinks": gitlinks}


def main():
    ap = argparse.ArgumentParser()
    for name in ("cache", "repo", "commit", "tag", "committed", "filter", "filter-sha1", "prefix", "index",
                 "url", "stats-out"):
        ap.add_argument(f"--{name}", required=True)
    a = ap.parse_args()
    prefix = a.prefix.strip("/")

    raw = git(a.cache, "ls-tree", "-r", "-z", "--full-tree", a.commit)
    entries = []
    for item in raw.split(b"\0"):
        if item:
            meta, path = item.decode("utf-8", "surrogateescape").split("\t", 1)
            mode, typ, sha = meta.split()
            entries.append((mode, typ, sha, path))
    upstream_paths = {e[3] for e in entries}
    if RECORD in upstream_paths:
        die(f"upstream now has its own {RECORD}; pick another record name before syncing")
    rules = load_filter(a.filter)
    for src, dest in rules["rename"].items():
        if dest in upstream_paths:
            die(f"rename {src} -> {dest}: upstream already has {dest}")
    copied, stats = select(entries, rules)
    if not copied:
        die("the filter copied nothing")

    # Copy the blobs the Timely repo lacks, straight from the cache (no checkout, byte-identical).
    shas = sorted({sha for _, sha, _ in copied})
    check = git(a.repo, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
                data=("\n".join(shas) + "\n").encode()).decode().splitlines()
    missing = [line.split()[0] for line in check if line.endswith(" missing")]
    if missing:
        pack = git(a.cache, "pack-objects", "--stdout", "-q", data=("\n".join(missing) + "\n").encode())
        git(a.repo, "index-pack", "--stdin", data=pack)
    sizes = dict(line.split() for line in git(
        a.repo, "cat-file", "--batch-check=%(objectname) %(objectsize)",
        data=("\n".join(shas) + "\n").encode()).decode().splitlines())

    lower = {}
    for _, _, path in copied:
        lower.setdefault(path.lower(), []).append(path)
    longest = max((f"{prefix}/{p}" for _, _, p in copied), key=len)
    stats = {
        "files": len(copied),
        "bytes": sum(int(sizes[sha]) for _, sha, _ in copied),
        **stats,
        "symlinks": sorted(p for m, _, p in copied if m == "120000"),
        "caseCollisions": sorted(v for v in lower.values() if len(v) > 1),
        "longestPath": {"length": len(longest), "path": longest,
                        "overWindowsWarn": sum(len(f"{prefix}/{p}") > WINDOWS_PATH_WARN for _, _, p in copied)},
    }
    record = {
        "repo": a.url,
        "tag": a.tag,
        "commit": a.commit,
        "committed": a.committed,
        "filterSha1": a.filter_sha1,
        "stats": stats,
    }
    body = json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    record_sha = git(a.repo, "hash-object", "-w", "--stdin", data=body.encode()).decode().strip()

    lines = [f"{mode} {sha}\t{prefix}/{path}" for mode, sha, path in copied]
    lines.append(f"100644 {record_sha}\t{prefix}/{RECORD}")
    env = {**os.environ, "GIT_INDEX_FILE": a.index}
    if os.path.exists(a.index):
        os.unlink(a.index)
    git(a.repo, "update-index", "--add", "-z", "--index-info",
        data=("\0".join(lines) + "\0").encode("utf-8", "surrogateescape"), env=env)
    tree = git(a.repo, "write-tree", env=env).decode().strip()
    with open(a.stats_out, "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=2, sort_keys=True)
    print(tree)


if __name__ == "__main__":
    main()

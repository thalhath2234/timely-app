#!/usr/bin/env python3
"""Post-sync checks a, c, d and e of plan section 10.4. Stdlib only; run with python3 -I.

`make hermes-sync-check` runs scripts/hermes-sync/check.sh (snapshot link, patch inventory b, no
npm or env files), then the unit tests of these scripts, then this file:

  a  no conflict markers or unmerged paths in apps/agent
  c  every .py file under apps/agent compiles (compileall with the agent interpreter, bytecode kept
     out of the tree)
  d  import smoke test with a fresh HERMES_HOME/HERMES_RUNTIME_DIR (check_dump.py in the agent venv)
  e  runtime tool dump vs tools.json; every tool classified by name and owner in policy/tools.yaml
     with current reviewed schema hashes; skills.json current; every bundled and offered optional
     skill tree matches policy/skills-reviewed.json; policy/skills-denied.json is current and no denied
     skill is default on or offered; skill-body.yaml tokens match tools.yaml;
     seams.json matches; tags.json records the imported tag

The agent interpreter is $HERMES_CHECK_PYTHON, else apps/agent/.venv (made by `make agent-install`).
HERMES_CHECK_STATIC_ONLY=1 (or --static-only) skips d and the runtime half of e and checks the
policy against the committed tools.json instead; CI never sets it.

Other modes:
  --write                  regenerate tools.json, skills.json, seams.json, policy/skills-denied.json
                           and the generated block of skill-body.yaml (what `make hermes-tools-dump`
                           runs), then check
  --review-skills F [F..]  record the current tree of skill folders (or bare names) in
                           skills-reviewed.json after reading them (`make hermes-skills-review`)
  --review-all             the same for every skill
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script's folder off sys.path
import check_lib  # noqa: E402
import check_policy  # noqa: E402
import check_seams  # noqa: E402

MARKER = re.compile(r"^(<{7}|>{7}|\|{7})( |$)", re.M)
SEPARATOR = re.compile(r"^={7}$", re.M)


def say(msg):
    print(f"hermes-sync-check: {msg}", flush=True)


def test_base():
    base = os.environ.get("TIMELY_AGENT_TEST_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "timely-agent-test")
    os.makedirs(base, exist_ok=True)
    return base


def agent_python():
    env = os.environ.get("HERMES_CHECK_PYTHON")
    if env:
        return env
    venv = check_lib.path(check_lib.AGENT_DIR + "/.venv")
    for cand in (os.path.join(venv, "bin", "python"), os.path.join(venv, "Scripts", "python.exe")):
        if os.path.isfile(cand):
            return cand
    return None


# ---------------------------------------------------------------- a
def conflict_markers(text):
    """Line numbers of conflict markers; a bare ======= counts only next to <<<<<<< or >>>>>>>."""
    hits = [text.count("\n", 0, m.start()) + 1 for m in MARKER.finditer(text)]
    if hits:
        hits += [text.count("\n", 0, m.start()) + 1 for m in SEPARATOR.finditer(text)]
    return sorted(hits)


def check_markers(snap):
    msgs = []
    unmerged = check_lib.git("ls-files", "-u", "--", check_lib.AGENT_DIR)
    for path in sorted({row.split("\t", 1)[1] for row in unmerged.splitlines() if "\t" in row}):
        msgs.append(f"{path} is unmerged (resolve the conflict and git add it)")
    # Timely files in apps/agent, plus vendored files that differ from the snapshot (identical
    # vendored files are upstream bytes and cannot hold a conflict of ours).
    files = set(check_lib.git("ls-files", "--", check_lib.AGENT_DIR, f":!{check_lib.PREFIX}").splitlines())
    files |= set(check_lib.git("ls-files", "--others", "--exclude-standard", "--", check_lib.AGENT_DIR).splitlines())
    if snap:
        files |= set(check_lib.git("diff", "--name-only", snap, "--", check_lib.PREFIX).splitlines())
    for rel in sorted(files):
        full = check_lib.path(rel)
        if not os.path.isfile(full):
            continue
        try:
            with open(full, encoding="utf-8", errors="strict") as fh:
                text = fh.read()
        except (UnicodeDecodeError, OSError):
            continue
        lines = conflict_markers(text)
        if lines:
            msgs.append(f"{rel}: conflict markers at lines {', '.join(map(str, lines[:10]))}")
    return msgs


# ---------------------------------------------------------------- c
def check_compile(python):
    with tempfile.TemporaryDirectory(prefix="pycache.", dir=test_base()) as cache:
        res = subprocess.run([python, "-I", "-X", f"pycache_prefix={cache}", "-m", "compileall", "-q", "-j", "0",
                              "-x", r"[/\\](\.venv|node_modules|__pycache__)([/\\]|$)", check_lib.path(check_lib.AGENT_DIR)],
                             capture_output=True, text=True)
    if res.returncode:
        out = (res.stdout + res.stderr).strip().splitlines()
        return [f"compileall failed ({python}):"] + [f"  {line}" for line in out[:40]]
    return []


# ---------------------------------------------------------------- d
def run_dump(python):
    with tempfile.TemporaryDirectory(prefix="dumpout.", dir=test_base()) as tmp:
        out = os.path.join(tmp, "dump.json")
        res = subprocess.run([python, "-I", "-B", os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_dump.py"),
                              "--out", out, "--hermes", check_lib.path(check_lib.PREFIX), "--base", test_base()],
                             capture_output=True, text=True)
        if not os.path.isfile(out):
            tail = "\n".join((res.stderr or res.stdout).strip().splitlines()[-30:])
            return None, [f"check_dump.py produced no output (exit {res.returncode}):\n{tail}"]
        with open(out, encoding="utf-8") as fh:
            dump = json.load(fh)
    return dump, [f"import smoke: {e}" for e in dump.get("errors", [])]


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--static-only", action="store_true", default=os.environ.get("HERMES_CHECK_STATIC_ONLY") == "1")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--review-skills", nargs="+", metavar="FOLDER")
    ap.add_argument("--review-all", action="store_true")
    a = ap.parse_args()

    upstream = check_lib.read_json(check_lib.PREFIX + "/HERMES_UPSTREAM.json")
    tag = upstream.get("tag")
    trees = check_policy.skill_trees()

    if a.review_skills or a.review_all:
        reviewed = check_lib.read_json(check_policy.SKILLS_REVIEWED)
        done = check_policy.review_skills(reviewed, trees, a.review_skills or [], everything=a.review_all,
                                          execs=check_policy.skill_execs(trees))
        check_lib.write_json(check_policy.SKILLS_REVIEWED, reviewed)
        for rel in done:
            e = reviewed["skills"][rel]
            state = f"default {e['default']}" if "default" in e else f"offered {str(e['offered']).lower()}"
            say(f"recorded {rel} at {e['tree']} ({state}); edit default/offered in {check_policy.SKILLS_REVIEWED} if needed")
        return 0

    failures = {}
    snap = check_lib.snapshot_commit()
    failures["a. conflict markers"] = check_markers(snap)

    python = agent_python()
    dump = None
    if a.static_only and not a.write:
        say("HERMES_CHECK_STATIC_ONLY: skipping d (import smoke) and the runtime tool dump; checking the policy "
            "against the committed tools.json")
        failures["c. compileall"] = check_compile(python or sys.executable)
    elif python is None:
        failures["c/d. agent interpreter"] = [
            "no agent interpreter: run `make agent-install` (or set HERMES_CHECK_PYTHON to a Python with "
            "Hermes' locked dependencies); HERMES_CHECK_STATIC_ONLY=1 skips the runtime checks"]
    else:
        failures["c. compileall"] = check_compile(python)
        dump, failures["d. import smoke"] = run_dump(python)

    hermes_dir = check_lib.path(check_lib.PREFIX)
    skills_doc = check_policy.skills_document(trees, hermes_dir, tag)
    seams_now = check_seams.compute(hermes_dir)

    if a.write:
        if dump is None:
            say("cannot --write without a runtime dump (needs the agent interpreter)")
            return 1
        check_lib.write_json(check_policy.TOOLS_JSON, check_policy.tools_document(dump, tag))
        check_lib.write_json(check_policy.SKILLS_JSON, skills_doc)
        check_lib.write_json(check_seams.SEAMS_JSON, check_seams.document(seams_now, tag))
        policy = check_lib.read_yaml(check_policy.TOOLS_YAML)
        check_lib.write_json(check_policy.SKILLS_DENIED, check_policy.denied_document(trees, hermes_dir, tag, policy))
        with open(check_lib.path(check_policy.SKILL_BODY), encoding="utf-8") as fh:
            body_text = fh.read()
        with open(check_lib.path(check_policy.SKILL_BODY), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(check_policy.render_tokens(body_text, check_policy.chat_gated_tokens(policy)))
        say(f"wrote {check_policy.TOOLS_JSON}, {check_policy.SKILLS_JSON}, {check_policy.SKILLS_DENIED}, "
            f"{check_seams.SEAMS_JSON} and the tool_tokens block of {check_policy.SKILL_BODY}; review the diff "
            "before committing")

    e = []
    try:
        policy = check_lib.read_yaml(check_policy.TOOLS_YAML)
    except (OSError, check_lib.YamlError) as exc:
        policy = None
        e.append(f"{check_policy.TOOLS_YAML}: {exc}")
    try:
        committed_tools = check_lib.read_json(check_policy.TOOLS_JSON)
    except (OSError, ValueError) as exc:
        committed_tools = None
        e.append(f"{check_policy.TOOLS_JSON}: {exc} (generate it with `{check_policy.REGEN}`)")
    if dump is not None and committed_tools is not None:
        e += check_policy.compare_dump(committed_tools, check_policy.tools_document(dump, tag), check_policy.TOOLS_JSON,
                                       ["upstream", "tools", "inline", "plugins"])
    source = dump if dump is not None else committed_tools
    if policy is not None and source is not None:
        e += check_policy.check_tools(policy, source)
    try:
        e += check_policy.compare_dump(check_lib.read_json(check_policy.SKILLS_JSON), skills_doc, check_policy.SKILLS_JSON,
                                       ["upstream", "bundled", "optional"])
    except (OSError, ValueError) as exc:
        e.append(f"{check_policy.SKILLS_JSON}: {exc} (generate it with `{check_policy.REGEN}`)")
    try:
        reviewed_doc = check_lib.read_json(check_policy.SKILLS_REVIEWED)
        e += check_policy.check_skills(reviewed_doc, trees, dump.get("skills") if dump else None,
                                       check_policy.skill_execs(trees), check_policy.skill_converted(trees))
    except (OSError, ValueError) as exc:
        reviewed_doc = None
        e.append(f"{check_policy.SKILLS_REVIEWED}: {exc}")
    if policy is not None:
        try:
            denied_doc = check_lib.read_json(check_policy.SKILLS_DENIED)
            e += check_policy.compare_dump(denied_doc, check_policy.denied_document(trees, hermes_dir, tag, policy),
                                           check_policy.SKILLS_DENIED, ["upstream", "mention_only_commands", "skills"])
            e += check_policy.check_denied(reviewed_doc, denied_doc)
        except (OSError, ValueError) as exc:
            e.append(f"{check_policy.SKILLS_DENIED}: {exc} (generate it with `{check_policy.REGEN}`)")
    if policy is not None:
        try:
            e += check_policy.check_skill_body(check_lib.read_yaml(check_policy.SKILL_BODY), policy)
        except (OSError, check_lib.YamlError) as exc:
            e.append(f"{check_policy.SKILL_BODY}: {exc}")
    try:
        seam_msgs = check_seams.compare(check_lib.read_json(check_seams.SEAMS_JSON), seams_now, check_seams.labels())
        if seam_msgs:
            seam_msgs.append("a seam Timely relies on changed: read the change, adapt timely_agent if needed, then "
                             f"regenerate seams.json with `{check_policy.REGEN}`")
        e += seam_msgs
    except (OSError, ValueError) as exc:
        e.append(f"{check_seams.SEAMS_JSON}: {exc} (generate it with `{check_policy.REGEN}`)")
    try:
        with open(check_lib.path(check_policy.GO_ENV), encoding="utf-8") as fh:
            go_is_denied = check_policy.go_denied(fh.read())
        e += check_policy.check_platform_env(check_policy.platform_env_names(hermes_dir), go_is_denied,
                                             check_policy.worker_forbidden())
    except (OSError, ValueError) as exc:
        e.append(f"messaging platform env: {exc}")
    try:
        e += check_policy.check_tags(check_lib.read_json(check_lib.SYNC_DIR + "/tags.json"), upstream)
    except (OSError, ValueError) as exc:
        e.append(f"{check_lib.SYNC_DIR}/tags.json: {exc}")
    failures["e. dumps and policy"] = e

    bad = {k: v for k, v in failures.items() if v}
    for section, msgs in bad.items():
        print(f"hermes-sync-check: FAILED {section}", file=sys.stderr)
        for m in msgs:
            print(f"  - {m}", file=sys.stderr)
    if bad:
        return 1
    n_tools = len(source["tools"]) if source else 0
    try:
        entries = check_lib.read_json(check_policy.SKILLS_REVIEWED)["skills"]
    except (OSError, ValueError, KeyError):
        entries = {}
    bundled = sum(1 for rel in trees if rel.startswith("skills/"))
    offered = sum(1 for rel in trees if not rel.startswith("skills/") and entries.get(rel, {}).get("offered"))
    mode = "static only, " if dump is None else ""
    say(f"{mode}{tag}: no conflict markers, apps/agent compiles"
        + ("" if dump is None else ", imports with a fresh home")
        + f", {n_tools} tools classified, {bundled} bundled and {offered} offered optional skills reviewed"
        f", {len(seams_now)} seams unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())

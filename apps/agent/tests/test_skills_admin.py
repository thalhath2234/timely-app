"""Bundled skills in phase 3 (plan 9.1-9.3, 9b.6; Q-3.7): the deny list keeps Hermes-self skills
out of the seed tree, the committed seed tree holds only reviewed trees, and "Updated upstream"
(``learning.upstream``) on real workers: list, compare, keep_mine, use_new, name collisions, and
Undo of a copy-on-write edit to a seeded bundled skill through the skill ledger."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

import harness
from timely_agent import paths, seed

TESTS = Path(__file__).resolve().parent
FIXTURE_SKILLS = TESTS / "fixtures" / "skills"
HERMES_SKILLS = paths.hermes_dir() / "skills"
TOOLSETS = ["timely", "todo", "skills", "memory"]
DEMO_V1 = "---\nname: demo-steps\ndescription: Steps for the demo list.\n---\n# Demo\n\n1. Read the list.\n2. Sort it.\n"
DEMO_V2 = DEMO_V1.replace("2. Sort it.", "2. Sort it by date.")
DEMO_V3 = DEMO_V1.replace("2. Sort it.", "2. Sort it by date, newest first.")
FRESH = "---\nname: fresh-steps\ndescription: Steps for the fresh list.\n---\n# Fresh\n\n1. Group the items.\n"
MINE = "---\nname: fresh-steps\ndescription: My own fresh steps.\n---\n# Fresh\n\n1. Group by store.\n"


# ---------------------------------------------------------------- deny list in the seed tree (no Hermes)

def _reviewed(rels: list[str], default: str = "on") -> dict:
    return {f"skills/{r}": {"tree": seed.git_tree_id(HERMES_SKILLS / r), "default": default} for r in rels}


def test_denied_skills_never_reach_the_seed_tree(tmp_path):
    """A denied skill is left out even with a matching reviewed entry, so no account can turn it on."""
    layout = paths.AgentLayout.at(tmp_path / "agent")
    rels = ["research/arxiv", "productivity/maps"]
    out, report = seed.build_seed_tree(layout, upstream=HERMES_SKILLS, overrides=None, reviewed=_reviewed(rels),
                                       denied={"skills/productivity/maps"})
    assert report["denied"] == ["skills/productivity/maps"] and report["seeded"] == ["skills/research/arxiv"]
    assert (out / "research" / "arxiv" / "SKILL.md").is_file()
    assert not (out / "productivity" / "maps").exists()
    assert "maps" not in report["default_off"]


def test_a_missing_deny_list_seeds_nothing(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    out, report = seed.build_seed_tree(layout, upstream=HERMES_SKILLS, overrides=None,
                                       reviewed=_reviewed(["research/arxiv"]), denied=None)
    assert not list(out.rglob("SKILL.md")) and report["seeded"] == []


def test_load_denied_reads_the_committed_file():
    denied = seed.load_denied(seed.denied_file_for(paths.skills_reviewed_file()))
    assert denied is not None and "skills/autonomous-ai-agents/hermes-agent" in denied
    assert seed.load_denied(paths.agent_dir() / "no-such-file.json") is None


def test_committed_seed_tree_holds_only_reviewed_trees_and_no_denied_skill():
    """The reviewed-skills gate end to end with the committed policy files: prepare's seed tree holds
    exactly the reviewed, not-denied bundled skills, each at its reviewed git tree id, and every
    default-off one is in skills_default_off."""
    reviewed = seed.load_reviewed(paths.skills_reviewed_file())
    denied = seed.load_denied(seed.denied_file_for(paths.skills_reviewed_file()))
    a = harness.Agent(harness.new_root("gate"))
    assert a.prepared["skills_denied_found"] is True
    tree = Path(a.prepared["seed_skills_dir"])
    seeded = {f"skills/{d.relative_to(tree).as_posix()}": d for d in seed.skill_dirs(tree)}
    assert seeded, "nothing was seeded"
    for rel, d in seeded.items():
        assert rel in reviewed, rel
        assert seed.git_tree_id(d) == reviewed[rel]["tree"], rel
        assert rel not in denied, rel
    want = {rel for rel, e in reviewed.items() if rel.startswith("skills/") and rel not in denied}
    assert set(seeded) == want
    off = {n for rel, e in reviewed.items() if rel in seeded and e["default"] == "off"
           for n in seed.skill_names(seeded[rel])}
    assert off <= set(a.prepared["skills_default_off"])
    assert a.prepared["seed"]["denied"] == sum(1 for rel in denied if rel.startswith("skills/"))


# ---------------------------------------------------------------- "Updated upstream" on real workers

def _upstream(root: Path, name: str, skills: dict[str, str]) -> tuple[Path, Path, Path]:
    """An upstream ``skills/`` tree, its reviewed file (every skill default on) and an empty deny list."""
    up = root / name / "skills"
    for rel, text in skills.items():
        (up / rel).mkdir(parents=True, exist_ok=True)
        (up / rel / "SKILL.md").write_text(text, encoding="utf-8")
    reviewed = {"version": 1, "skills": {f"skills/{rel}": {"tree": seed.git_tree_id(up / rel), "default": "on"}
                                         for rel in skills}}
    rfile = root / name / "skills-reviewed.json"
    rfile.write_text(json.dumps(reviewed), encoding="utf-8")
    dfile = root / name / "skills-denied.json"
    dfile.write_text(json.dumps({"version": 1, "skills": {}}), encoding="utf-8")
    return up, rfile, dfile


def _prepare(a: harness.Agent, up: Path, rfile: Path, dfile: Path) -> None:
    out = harness.run_cli("prepare", a.dir, {"timely_skills_src": str(FIXTURE_SKILLS), "upstream_skills": str(up),
                                             "skills_reviewed": str(rfile), "skills_denied": str(dfile)})
    assert out.get("ok"), out
    a.prepared = out
    a.render({})


def _start(a: harness.Agent) -> harness.Worker:
    w, ready = harness.ready_worker(a, hello={"timely_tools": harness.timely_tools()})
    assert ready["self_test"]["ok"], ready["self_test"]
    w.ready_msg = ready
    return w


def ask(w, a, mtype, **fields) -> dict:
    mid = f"go-{mtype}-{time.monotonic_ns()}"
    w.send({"type": mtype, "id": mid, "account": a.account, **fields})
    while True:
        msg = w.recv(60)
        if msg.get("id") == mid and msg.get("type") in ("learning.result", "error"):
            return msg


def upstream(w, a, action, **fields) -> dict:
    res = ask(w, a, "learning.upstream", action=action, **fields)
    assert res["type"] == "learning.result" and res["ok"], res
    return res["data"]


@pytest.fixture(scope="module")
def ua():
    root = harness.new_root("up")
    a = harness.Agent(root, prepare_opts={"timely_skills_src": str(FIXTURE_SKILLS)})
    a.up_root = root
    _prepare(a, *_upstream(root, "v1", {"lists/demo-steps": DEMO_V1}))
    return a


def _demo(a) -> Path:
    return a.home / "skills" / "lists" / "demo-steps" / "SKILL.md"


def test_undo_of_an_agent_edit_to_a_bundled_skill_is_a_ledger_rollback(ua, stub):
    """Q-3.7: the agent's edit to a seeded bundled skill changes only the account's own copy (copy on
    write) and is a ledger entry; Undo (learning.rollback) restores the seeded text, and the skill
    reads as bundled (pristine) again."""
    w = _start(ua)
    try:
        assert _demo(ua).read_text(encoding="utf-8") == DEMO_V1
        steps = [{"calls": [["skill_manage", {"action": "patch", "name": "demo-steps", "old_string": "2. Sort it.",
                                              "new_string": "2. Sort it by store."}]]}]
        w.send(harness.run_start(ua, stub, run_id="up-r1", conversation="c-up-1", toolsets=TOOLSETS,
                                 text="SCRIPT " + json.dumps(steps) + " tag-up-1", budgets={},
                                 flags={"learning_writes": True}))
        _done, seen = harness.drive(w, ua.account, "up-r1", timeout=120)
        events = [m["event"] for m in seen if m.get("type") == "learning" and m["event"]["subject"] == "demo-steps"]
        assert [(e["action"], e["status"]) for e in events] == [("patched", "applied")], events
        assert "Sort it by store." in _demo(ua).read_text(encoding="utf-8")
        seeded = Path(ua.prepared["seed_skills_dir"]) / "lists" / "demo-steps" / "SKILL.md"
        assert seeded.read_text(encoding="utf-8") == DEMO_V1  # the shipped copy never changes
        rows = {s["name"]: s for s in ask(w, ua, "learning.list", what="skills")["data"]["skills"]}
        assert rows["demo-steps"]["source"] == "edited"
        undo = ask(w, ua, "learning.rollback", ledger_entry_id=events[0]["ledger_entry_id"])
        assert undo["type"] == "learning.result" and undo["ok"], undo
        assert _demo(ua).read_text(encoding="utf-8") == DEMO_V1
        rows = {s["name"]: s for s in ask(w, ua, "learning.list", what="skills")["data"]["skills"]}
        assert rows["demo-steps"]["source"] == "bundled"
        assert upstream(w, ua, "list") == {"upstream": [], "count": 0}
    finally:
        w.close()


def test_updated_upstream_compare_keep_mine_and_use_new(ua):
    """An edited bundled skill whose shipped copy changes shows "Updated upstream"; keep_mine clears
    the notice until the next shipped change; use_new restores the shipped copy as an undoable
    ledger entry."""
    w = _start(ua)
    try:
        res = ask(w, ua, "learning.edit", name="demo-steps", content=DEMO_V1.replace("Sort it.", "Sort it by aisle."))
        assert res["ok"], res
    finally:
        w.close()
    _prepare(ua, *_upstream(ua.up_root, "v2", {"lists/demo-steps": DEMO_V2}))
    w = _start(ua)
    try:
        assert w.ready_msg["skills_upstream"] == 1
        assert "by aisle" in _demo(ua).read_text(encoding="utf-8")  # Hermes' sync kept the edited copy
        listed = upstream(w, ua, "list")
        assert [(u["name"], u["kind"]) for u in listed["upstream"]] == [("demo-steps", "edited")]
        assert listed["upstream"][0]["upstream_changed_at"]
        cmp = upstream(w, ua, "compare", name="demo-steps")
        assert "by aisle" in cmp["mine"] and "Sort it by date." in cmp["upstream"]
        assert "-2. Sort it by aisle." in cmp["diff"] and "+2. Sort it by date." in cmp["diff"]
        missing = ask(w, ua, "learning.upstream", action="compare", name="no-such-skill")
        assert missing["type"] == "error" and missing["code"] == "not_found", missing
        kept = upstream(w, ua, "keep_mine", name="demo-steps")
        assert kept["kept"] and kept["count"] == 0
        assert upstream(w, ua, "list")["count"] == 0
        assert "by aisle" in _demo(ua).read_text(encoding="utf-8")
    finally:
        w.close()
    w = _start(ua)  # the choice outlives the worker
    try:
        assert w.ready_msg["skills_upstream"] == 0
    finally:
        w.close()
    _prepare(ua, *_upstream(ua.up_root, "v3", {"lists/demo-steps": DEMO_V3}))
    w = _start(ua)
    try:
        assert w.ready_msg["skills_upstream"] == 1  # a newer shipped change shows again
        used = upstream(w, ua, "use_new", name="demo-steps")
        assert used["ok"] and used["count"] == 0 and used["ledger_entry_id"], used
        assert [(e["action"], e["origin"]) for e in used["events"]] == [("edited", "user")]
        assert _demo(ua).read_text(encoding="utf-8") == DEMO_V3
        rows = {s["name"]: s for s in ask(w, ua, "learning.list", what="skills")["data"]["skills"]}
        assert rows["demo-steps"]["source"] == "bundled"
        undo = ask(w, ua, "learning.rollback", ledger_entry_id=used["ledger_entry_id"])
        assert undo["ok"], undo
        assert "by aisle" in _demo(ua).read_text(encoding="utf-8")
    finally:
        w.close()


def test_a_learned_skill_named_like_a_new_bundled_one_is_a_collision(ua):
    """9b.6: a learned skill at the path of a newly shipped bundled skill is kept by Hermes' sync and
    surfaced as "Updated upstream"; use_new replaces it with the shipped copy (undoable)."""
    mine = ua.home / "skills" / "lists" / "fresh-steps"
    mine.mkdir(parents=True, exist_ok=True)
    (mine / "SKILL.md").write_text(MINE, encoding="utf-8")
    _prepare(ua, *_upstream(ua.up_root, "v4", {"lists/demo-steps": DEMO_V3, "lists/fresh-steps": FRESH}))
    w = _start(ua)
    try:
        assert (mine / "SKILL.md").read_text(encoding="utf-8") == MINE
        kinds = {u["name"]: u["kind"] for u in upstream(w, ua, "list")["upstream"]}
        assert kinds.get("fresh-steps") == "collision", kinds
        cmp = upstream(w, ua, "compare", name="fresh-steps")
        assert "Group by store." in cmp["mine"] and "Group the items." in cmp["upstream"]
        used = upstream(w, ua, "use_new", name="fresh-steps")
        assert used["ok"], used
        assert (mine / "SKILL.md").read_text(encoding="utf-8") == FRESH
        assert "fresh-steps" not in {u["name"] for u in upstream(w, ua, "list")["upstream"]}
        bad = ask(w, ua, "learning.upstream", action="merge", name="fresh-steps")
        assert bad["type"] == "error", bad
    finally:
        w.close()

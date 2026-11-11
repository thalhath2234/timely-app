"""Agent-state backup helpers without Hermes (plan 6.5): the never-restore rules, ledger path
rewriting, and the reconcile that finishes or drops a staged restore, both ways, including the
one ``prepare`` runs. Export and import with Hermes are contract test 13."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import harness
from timely_agent import backup, paths

UID = "user-restore"


def _layout(tmp_path, instance: dict | None = None) -> paths.AgentLayout:
    layout = paths.AgentLayout.at(tmp_path / "agent")
    layout.ensure()
    layout.instance_file.write_text(json.dumps(instance or {"layout_version": 1}), encoding="utf-8")
    return layout


def _stage(layout: paths.AgentLayout, account: str = UID, *, committed: bool, instance: str = "",
           stamp: str = "20261111T101112Z-abcdef", marker: str = "staged") -> Path:
    name = paths.account_dir_name(account)
    staged = layout.accounts_dir / f".restore-{name}-{stamp}"
    (staged / "memories").mkdir(parents=True)
    (staged / "memories" / "USER.md").write_text(marker, encoding="utf-8")
    (staged / backup.RESTORE_META).write_text(json.dumps({"account_dir": name, "instance": instance}), encoding="utf-8")
    if committed:
        backup.commit_marker(staged)
    return staged


def _live(layout: paths.AgentLayout, account: str = UID, text: str = "live") -> Path:
    home = layout.ensure_home(account)
    (home / "memories" / "USER.md").write_text(text, encoding="utf-8")
    return home


def test_committed_restore_is_swapped_in_and_the_old_home_goes_to_trash(tmp_path):
    layout = _layout(tmp_path)
    home = _live(layout)
    staged = _stage(layout, committed=True)
    out = backup.reconcile(layout)
    assert out["swapped"] == [home.name] and out["removed"] == []
    assert (home / "memories" / "USER.md").read_text(encoding="utf-8") == "staged"
    assert not (home / backup.COMMITTED).exists() and not (home / backup.RESTORE_META).exists()
    assert not staged.exists()
    trashed = list(layout.trash_dir.iterdir())
    assert len(trashed) == 1 and (trashed[0] / "memories" / "USER.md").read_text(encoding="utf-8") == "live"


def test_uncommitted_restore_is_dropped_and_the_live_home_kept(tmp_path):
    layout = _layout(tmp_path)
    home = _live(layout)
    staged = _stage(layout, committed=False)
    out = backup.reconcile(layout)
    assert out["swapped"] == [] and out["removed"] == [staged.name]
    assert not staged.exists()
    assert (home / "memories" / "USER.md").read_text(encoding="utf-8") == "live"


def test_a_committed_restore_for_a_fresh_account_is_swapped_in(tmp_path):
    layout = _layout(tmp_path)
    _stage(layout, committed=True)
    out = backup.reconcile(layout)
    home = layout.account_home(UID)
    assert out["swapped"] == [home.name] and (home / "memories" / "USER.md").read_text(encoding="utf-8") == "staged"
    assert not layout.trash_dir.exists() or not list(layout.trash_dir.iterdir())


def test_a_restore_staged_for_another_agent_folder_is_never_swapped_in(tmp_path):
    """Guarded by instance.json: a staged folder that names another instance (a data folder copied
    from elsewhere) is dropped, not applied."""
    layout = _layout(tmp_path, {"layout_version": 1, "id": "instance-b"})
    home = _live(layout)
    staged = _stage(layout, committed=True, instance="instance-a")
    out = backup.reconcile(layout)
    assert out["swapped"] == [] and out["removed"] == [staged.name]
    assert (home / "memories" / "USER.md").read_text(encoding="utf-8") == "live"
    ok = _stage(layout, committed=True, instance="instance-b", stamp="20261111T101113Z-abcdef")
    assert backup.reconcile(layout)["swapped"] == [home.name] and not ok.exists()


def test_a_misnamed_or_mismatched_staged_folder_is_dropped(tmp_path):
    layout = _layout(tmp_path)
    other = _stage(layout, committed=True)
    # the folder name and RESTORE.json disagree about the account
    (other / backup.RESTORE_META).write_text(json.dumps({"account_dir": "account-" + "0" * 24, "instance": ""}))
    odd = layout.accounts_dir / ".restore-junk"
    odd.mkdir()
    out = backup.reconcile(layout)
    assert sorted(out["removed"]) == sorted([other.name, odd.name]) and out["swapped"] == []


def test_reconcile_needs_instance_json(tmp_path):
    layout = paths.AgentLayout.at(tmp_path / "agent")
    layout.ensure()
    with pytest.raises(backup.BackupError):
        backup.reconcile(layout)


def test_prepare_runs_reconcile_both_ways(tmp_path):
    """A crash between Go's COMMITTED marker and the swap is finished at the next prepare; a crash
    before the marker is rolled back."""
    root = harness.new_root("rec")
    a = harness.Agent(root, account=UID)
    layout = a.layout
    _live(layout)
    committed = _stage(layout, committed=True)
    out = harness.run_cli("prepare", a.dir, {})
    assert out["ok"] and out["restores"]["swapped"] == [paths.account_dir_name(UID)], out
    assert not committed.exists()
    assert (layout.account_home(UID) / "memories" / "USER.md").read_text(encoding="utf-8") == "staged"
    dropped = _stage(layout, committed=False, marker="never")
    out = harness.run_cli("prepare", a.dir, {})
    assert out["ok"] and out["restores"]["removed"] == [dropped.name], out
    assert (layout.account_home(UID) / "memories" / "USER.md").read_text(encoding="utf-8") == "staged"
    rec = harness.run_cli("agent-reconcile", a.dir, {})
    assert rec["ok"] and rec["swapped"] == [] and rec["removed"] == [], rec


@pytest.mark.parametrize("rel,why", [
    ("config.yaml", "not agent state"), ("SOUL.md", "not agent state"), (".env", "secret"),
    (".env.local", "secret"), ("auth.json", "secret"), ("mcp-tokens/server.json", "secret"),
    ("skills/learned/x/.env", "secret"), ("scripts/run.sh", "not agent state"), ("hooks/h.py", "not agent state"),
    ("plugins/p/__init__.py", "not agent state"), ("home/.bashrc", "not agent state"),
    ("workspace/a.txt", "not agent state"), ("logs/agent.log", "not agent state"), ("cache/x", "not agent state"),
    ("skills/.locks/ledger.lock", "not agent state"), (".curator_backups/2026/skills.tar.gz", "not agent state"),
    ("memories/USER.md", ""), ("skills/cat/x/SKILL.md", ""), ("skills/.curator_ledger.jsonl", ""),
    ("skills/.usage.json", ""), (".curator_backups/blobs/abc", ""), ("pending/skills/1.json", ""),
    (".timely/counters.json", ""), ("state.db", ""),
])
def test_never_restore_rules(rel, why):
    assert backup.why_never(tuple(rel.split("/"))) == why


@pytest.mark.parametrize("name,ok", [
    ("memories/USER.md", True), ("/etc/passwd", False), ("../x", False), ("a/../../x", False),
    ("C:/Windows/x", False), ("c:\\x", False), ("", False), ("skills\\cat\\x\\SKILL.md", True),
])
def test_archive_member_paths(name, ok):
    assert (backup._safe_parts(name) is not None) == ok


def test_ledger_paths_move_to_the_new_home(tmp_path):
    new = str(tmp_path / "new")
    assert backup.rewrite_path("/old/home/skills/a/SKILL.md", "/old/home", new) == str(tmp_path / "new" / "skills" / "a" / "SKILL.md")
    assert backup.rewrite_path("C:\\old\\home\\skills\\a\\SKILL.md", "C:\\old\\home", new) == \
        str(tmp_path / "new" / "skills" / "a" / "SKILL.md")
    # no description of the old home: the skills/ part places it
    assert backup.rewrite_path("/elsewhere/h/skills/a/SKILL.md", "", new) == str(tmp_path / "new" / "skills" / "a" / "SKILL.md")
    assert backup.rewrite_path("/etc/passwd", "/old/home", new) is None

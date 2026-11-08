"""Unit tests for the post-sync check scripts. Stdlib unittest; `make hermes-sync-check` runs them:
  python3 -I -m unittest discover -s scripts/hermes-sync -p 'check_test.py'
"""
import ast
import copy
import os
import re
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_dump  # noqa: E402
import check_lib  # noqa: E402
import check_policy  # noqa: E402
import check_seams  # noqa: E402
import check_sync  # noqa: E402

SHA_A = "a" * 64
SHA_B = "b" * 64


class YamlSubset(unittest.TestCase):
    def test_nested_maps_lists_and_scalars(self):
        doc = check_lib.yaml_load(textwrap.dedent("""\
            # comment
            version: 1
            tools:
              web_search@core:
                chat: allow   # trailing comment
                gates: [web-toggle, 'a b', "c#d"]
                note: "it's \\"quoted\\""
            items:
              - 'don''t'
              - plain_value
            flag: false
            nothing: null
            """))
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["tools"]["web_search@core"]["gates"], ["web-toggle", "a b", "c#d"])
        self.assertEqual(doc["tools"]["web_search@core"]["note"], 'it\'s "quoted"')
        self.assertEqual(doc["items"], ["don't", "plain_value"])
        self.assertIs(doc["flag"], False)
        self.assertIsNone(doc["nothing"])

    def test_rejects_ambiguous_yaml(self):
        bad = {
            "tab": "a:\n\tb: 1\n",
            "yes": "a: yes\n",
            "on": "default: on\n",
            "float": "a: 1.5\n",
            "date": "a: 2026-11-09\n",
            "leading zero": "a: 0123\n",
            "duplicate": "a: 1\na: 2\n",
            "colon in flow": "a: [x:y]\n",
            "anchor": "a: &x b\n",
            "nested list": "a:\n  - [1]\n",
            "map in list": "a:\n  - b: 1\n",
            "bad indent": "a:\n  b: 1\n   c: 2\n",
            "doc marker": "---\na: 1\n",
            "empty": "a:\n",
            "unterminated": "a: 'x\n",
        }
        for label, text in bad.items():
            with self.subTest(label), self.assertRaises(check_lib.YamlError):
                check_lib.yaml_load(text)

    def test_scalar_round_trip(self):
        for value in ["web", "plugin:platforms/a2a", "on", "123abc", "2026-11-09", "a b", "it's", "x#y", 7, True, None, "-x"]:
            with self.subTest(value=value):
                self.assertEqual(check_lib.yaml_load(f"k: {check_lib.yaml_scalar(value)}\n")["k"], value)

    def test_committed_policy_files_parse(self):
        policy = check_lib.read_yaml(check_policy.TOOLS_YAML)
        self.assertEqual(check_policy.validate_tools_policy(policy), [])
        body = check_lib.read_yaml(check_policy.SKILL_BODY)
        self.assertEqual(check_policy.check_skill_body(body, policy), [])


class SchemaHash(unittest.TestCase):
    def test_dump_and_lib_hash_agree(self):
        schema = {"name": "x", "parameters": {"type": "object", "properties": {"b": {}, "a": {"description": "é"}}}}
        self.assertEqual(check_lib.schema_sha256(schema), check_dump.schema_sha256(schema))
        reordered = {"parameters": {"properties": {"a": {"description": "é"}, "b": {}}, "type": "object"}, "name": "x"}
        self.assertEqual(check_lib.schema_sha256(schema), check_lib.schema_sha256(reordered))


SOURCE = textwrap.dedent("""\
    HOOKS = {"pre_tool_call", "post_tool_call"}


    def stage_write(path, content, *, origin=None):
        return path


    class SessionDB:
        def open(self, path):
            pass

        def _private(self):
            pass
    """)
FIXTURE_SEAMS = [
    ("hooks", "mod.py", "module:HOOKS"),
    ("stage", "mod.py", "stage_write"),
    ("session methods", "mod.py", "SessionDB.*"),
]


class Seams(unittest.TestCase):
    def tree(self, files):
        d = tempfile.mkdtemp(prefix="seams.")
        self.addCleanup(__import__("shutil").rmtree, d)
        for rel, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            with open(os.path.join(d, rel), "w") as fh:
                fh.write(text)
        return d

    def recorded(self):
        return check_seams.compute(self.tree({"mod.py": SOURCE}), FIXTURE_SEAMS)

    def compare(self, files):
        labels = [label for label, _, _ in FIXTURE_SEAMS]
        return check_seams.compare({"seams": self.recorded()}, check_seams.compute(self.tree(files), FIXTURE_SEAMS), labels)

    def test_unchanged_passes(self):
        self.assertEqual(self.compare({"mod.py": SOURCE}), [])
        rec = self.recorded()
        self.assertEqual(rec["stage"]["line"], 4)
        self.assertEqual(rec["session methods"]["signature"], "class SessionDB()\ndef open(self, path)")

    def test_line_move_fails(self):
        msgs = self.compare({"mod.py": "# new first line\n" + SOURCE})
        self.assertTrue(any("'stage' moved from line 4 to mod.py:5" in m for m in msgs), msgs)

    def test_signature_change_fails(self):
        msgs = self.compare({"mod.py": SOURCE.replace("*, origin=None", "*, origin=None, actor=None")})
        self.assertTrue(any("'stage' changed signature" in m and "actor=None" in m for m in msgs), msgs)

    def test_body_change_fails(self):
        msgs = self.compare({"mod.py": SOURCE.replace("return path", "return None")})
        self.assertEqual(msgs, ["seam 'stage' changed body (mod.py:4)"])

    def test_private_method_counts_in_body_hash(self):
        msgs = self.compare({"mod.py": SOURCE.replace("def _private(self):\n        pass", "def _private(self):\n        return 1")})
        self.assertEqual(msgs, ["seam 'session methods' changed body (mod.py:8)"])

    def test_move_to_other_file_is_found(self):
        moved = SOURCE.replace("def stage_write(path, content, *, origin=None):\n    return path\n", "")
        msgs = self.compare({"mod.py": moved, "pkg/other.py": "def stage_write(path, content, *, origin=None):\n    return path\n"})
        self.assertTrue(any("'stage' moved from mod.py to pkg/other.py:1" in m for m in msgs), msgs)

    def test_gone_unrecorded_and_stale(self):
        labels = [label for label, _, _ in FIXTURE_SEAMS]
        current = check_seams.compute(self.tree({"mod.py": "X = 1\n"}), FIXTURE_SEAMS)
        recorded = self.recorded()
        recorded["old seam"] = {"file": "x.py", "line": 1}
        msgs = check_seams.compare({"seams": recorded}, current, labels)
        self.assertTrue(any("'stage' is gone" in m for m in msgs))
        self.assertTrue(any("'old seam' that check_seams.py no longer lists" in m for m in msgs))
        msgs = check_seams.compare({"seams": {}}, current, labels)
        self.assertTrue(any("'stage' is not in the copy and not recorded" in m for m in msgs))

    def test_iters_reset_sites(self):
        d = self.tree({"agent/tool_executor.py": "def run(agent):\n    agent._iters_since_skill = 0\n",
                       "tests/test_x.py": "def t(agent):\n    agent._iters_since_skill = 0\n"})
        out = check_seams.compute(d)
        self.assertEqual(out[check_seams.ITERS_LABEL]["signature"], "agent/tool_executor.py::run")

    def test_report_seams_match_report_py(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "report.py")) as fh:
            tree = ast.parse(fh.read())
        seams = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == "SEAMS" for t in n.targets))
        self.assertEqual([tuple(s) for s in seams], check_seams.REPORT_SEAMS)
        labels = check_seams.labels()
        self.assertEqual(len(labels), len(set(labels)), "seam labels must be unique")


def dump(**overrides):
    d = {
        "tools": {
            "web_search": {"toolset": "web", "owner": "core", "module": "tools.web_tools", "schema_sha256": SHA_A},
            "terminal": {"toolset": "terminal", "owner": "core", "module": "tools.terminal_tool", "schema_sha256": SHA_A},
            "discord": {"toolset": "discord", "owner": "core", "module": "tools.discord_tool", "schema_sha256": SHA_A},
            "a2a_call": {"toolset": "a2a", "owner": "plugin:platforms/a2a", "module": "x", "schema_sha256": SHA_A},
            "memory": {"toolset": "memory", "owner": "core", "module": "tools.memory_tool", "schema_sha256": SHA_A},
        },
        "inline": {"bridge": ["tool_call"], "message_agent": {"name": "message_agent", "schema_sha256": SHA_A},
                   "agent_loop": ["memory"]},
        "plugins": {"platforms/a2a": ["a2a_call"]},
    }
    d.update(overrides)
    return d


def policy():
    def e(toolset, chat, bot, phase=2, schema=SHA_A, **kw):
        out = {"toolset": toolset, "chat": chat, "bot": bot, "phase": phase, "note": "n", **kw}
        if schema:
            out["schema"] = schema
        return out
    return {
        "version": 1, "unknown": "block",
        "tools": {
            "web_search@core": e("web", "allow", "allow", 3, gates=["web-toggle"]),
            "terminal@core": e("terminal", "approve", "block", 5),
            "discord@core": e("discord", "block", "block", "never", schema=None),
            "a2a_call@plugin:platforms/a2a": e("a2a", "block", "block", "never", schema=None),
            "memory@core": e("memory", "allow", "allow", 3),
        },
        "inline": {
            "tool_call@core": {"chat": "block", "bot": "block", "phase": 2, "note": "n"},
            "message_agent@core": {"chat": "block", "bot": "block", "phase": "never", "note": "n"},
        },
    }


class Tools(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(check_policy.check_tools(policy(), dump()), [])

    def test_new_tool_fails(self):
        d = dump()
        d["tools"]["kanban_new"] = {"toolset": "kanban", "owner": "core", "module": "m", "schema_sha256": SHA_B}
        msgs = check_policy.check_tools(policy(), d)
        self.assertEqual(len(msgs), 1)
        self.assertIn("new tool `kanban_new`", msgs[0])
        self.assertIn("kanban_new@core", msgs[0])

    def test_owner_mismatch_fails(self):
        d = dump()
        d["tools"]["terminal"]["owner"] = "plugin:evil"
        msgs = check_policy.check_tools(policy(), d)
        self.assertEqual(len(msgs), 1)
        self.assertIn("registered by plugin:evil", msgs[0])

    def test_schema_change_on_offered_tool_fails(self):
        for name in ("web_search", "terminal"):
            d = dump()
            d["tools"][name]["schema_sha256"] = SHA_B
            msgs = check_policy.check_tools(policy(), d)
            self.assertEqual(len(msgs), 1, msgs)
            self.assertIn(f"`{name}@core`", msgs[0])
            self.assertIn(SHA_B, msgs[0])

    def test_schema_change_on_blocked_tool_passes(self):
        d = dump()
        d["tools"]["discord"]["schema_sha256"] = SHA_B
        self.assertEqual(check_policy.check_tools(policy(), d), [])

    def test_toolset_move_fails(self):
        d = dump()
        d["tools"]["discord"]["toolset"] = "messaging"
        self.assertIn("moved from toolset discord to messaging", check_policy.check_tools(policy(), d)[0])

    def test_removed_tool_entry_is_stale(self):
        d = dump()
        del d["tools"]["discord"]
        msgs = check_policy.check_tools(policy(), d)
        self.assertEqual(len(msgs), 1)
        self.assertIn("no longer registers `discord`", msgs[0])

    def test_timely_and_mcp_entries_may_be_absent(self):
        p = policy()
        p["tools"]["cronjob_manage@plugin:timely_bot"] = {"toolset": "timely_schedule", "chat": "allow", "bot": "block",
                                                          "phase": 6, "schema": SHA_A, "note": "shim"}
        self.assertEqual(check_policy.check_tools(p, dump()), [])

    def test_second_owner_for_present_tool_is_stale(self):
        p = policy()
        p["tools"]["terminal@plugin:other"] = dict(p["tools"]["terminal@core"])
        msgs = check_policy.check_tools(p, dump())
        self.assertEqual(len(msgs), 1)
        self.assertIn("only core registers it", msgs[0])

    def test_inline_changes_fail(self):
        d = dump()
        d["inline"]["bridge"] = ["tool_call", "tool_search"]
        self.assertIn("inline tool `tool_search`", check_policy.check_tools(policy(), d)[0])
        d = dump()
        d["inline"]["bridge"] = []
        self.assertIn("`inline:` lists `tool_call`", check_policy.check_tools(policy(), d)[0])

    def test_validation(self):
        cases = {
            "bad disposition": lambda p: p["tools"]["terminal@core"].update(chat="ask"),
            "missing schema": lambda p: p["tools"]["terminal@core"].pop("schema"),
            "never but allowed": lambda p: p["tools"]["discord@core"].update(chat="allow", schema=SHA_A),
            "unknown gate": lambda p: p["tools"]["web_search@core"].update(gates=["nope"]),
            "bad phase": lambda p: p["tools"]["terminal@core"].update(phase=12),
            "bad key": lambda p: p["tools"].update({"nokey": p["tools"]["terminal@core"]}),
            "unknown field": lambda p: p["tools"]["terminal@core"].update(extra=1),
            "unknown not block": lambda p: p.update(unknown="allow"),
            "missing note": lambda p: p["tools"]["terminal@core"].pop("note"),
        }
        for label, mutate in cases.items():
            with self.subTest(label):
                p = copy.deepcopy(policy())
                mutate(p)
                self.assertTrue(check_policy.validate_tools_policy(p))

    def test_compare_dump(self):
        old = {"tools": {"a": 1, "b": 2}, "inline": [1]}
        new = {"tools": {"a": 1, "c": 3}, "inline": [1]}
        msgs = check_policy.compare_dump(old, new, "tools.json", ["tools", "inline"])
        self.assertTrue(any("`c` is new" in m for m in msgs))
        self.assertTrue(any("`b` is gone" in m for m in msgs))
        self.assertIn("regenerate", msgs[-1])
        self.assertEqual(check_policy.compare_dump(old, copy.deepcopy(old), "x", ["tools", "inline"]), [])


TREE1 = "1" * 40
TREE2 = "2" * 40


class Skills(unittest.TestCase):
    trees = {"skills/p/one": TREE1, "optional-skills/c/two": TREE1, "optional-skills/c/three": TREE1}

    def reviewed(self):
        return {"version": 1, "skills": {
            "skills/p/one": {"tree": TREE1, "default": "on"},
            "optional-skills/c/two": {"tree": TREE1, "offered": True},
            "optional-skills/c/three": {"tree": TREE1, "offered": False, "reason": "r"},
        }}

    def check(self, trees=None, reviewed=None, runtime=None):
        return check_policy.check_skills(reviewed or self.reviewed(), trees or self.trees, runtime)

    def test_clean(self):
        self.assertEqual(self.check(runtime={"one": "skills/p/one"}), [])

    def test_new_skill_fails(self):
        trees = dict(self.trees, **{"skills/p/new": TREE1})
        msgs = self.check(trees)
        self.assertEqual(len(msgs), 1)
        self.assertIn("new bundled skill skills/p/new", msgs[0])
        trees = dict(self.trees, **{"optional-skills/c/new": TREE1})
        self.assertIn("new optional skill", self.check(trees)[0])

    def test_changed_tree(self):
        msgs = self.check(dict(self.trees, **{"skills/p/one": TREE2}))
        self.assertIn("bundled skill skills/p/one changed upstream", msgs[0])
        msgs = self.check(dict(self.trees, **{"optional-skills/c/two": TREE2}))
        self.assertIn("(offered in Settings) changed upstream", msgs[0])
        self.assertEqual(self.check(dict(self.trees, **{"optional-skills/c/three": TREE2})), [])

    def test_stale_and_invalid(self):
        r = self.reviewed()
        r["skills"]["skills/p/gone"] = {"tree": TREE1, "default": "on"}
        self.assertIn("not a skill in the copy any more", self.check(reviewed=r)[0])
        r = self.reviewed()
        r["skills"]["skills/p/one"]["default"] = True
        self.assertIn('default "on" or "off"', self.check(reviewed=r)[0])
        r = self.reviewed()
        r["skills"]["optional-skills/c/two"]["offered"] = "yes"
        self.assertIn("offered true or false", self.check(reviewed=r)[0])

    def test_runtime_discovery_mismatch(self):
        msgs = self.check(runtime={})
        self.assertIn("does not discover", msgs[0])

    def test_review_records_and_keeps_choices(self):
        r = self.reviewed()
        trees = dict(self.trees, **{"skills/p/one": TREE2, "skills/p/new": TREE2})
        done = check_policy.review_skills(r, trees, ["one", "skills/p/new"])
        self.assertEqual(done, ["skills/p/new", "skills/p/one"])
        self.assertEqual(r["skills"]["skills/p/one"], {"tree": TREE2, "default": "on"})
        self.assertEqual(r["skills"]["skills/p/new"], {"tree": TREE2, "default": "off"})
        with self.assertRaises(SystemExit):
            check_policy.review_skills(r, trees, ["missing"])

    def test_signals(self):
        d = tempfile.mkdtemp(prefix="skill.")
        self.addCleanup(__import__("shutil").rmtree, d)
        with open(os.path.join(d, "SKILL.md"), "w") as fh:
            fh.write("Run `hermes cron add` and keep state in ~/.hermes/state.json; hermes is great.\n")
        with open(os.path.join(d, "ok.md"), "w") as fh:
            fh.write('source "${HERMES_HOME:-$HOME/.hermes}/.env"; ${HERMES_HOME:-~/.hermes}\n')
        self.assertEqual(check_policy.skill_signals(d), (["cron"], True))
        os.remove(os.path.join(d, "SKILL.md"))
        self.assertEqual(check_policy.skill_signals(d), ([], False))

    def test_frontmatter_name(self):
        self.assertEqual(check_policy.frontmatter_name("---\nname: 'price'\ndescription: x\n---\nbody", "f"), "price")
        self.assertEqual(check_policy.frontmatter_name("no frontmatter", "f"), "f")


class SkillBody(unittest.TestCase):
    def body(self, tokens):
        return {"version": 1, "tool_tokens": tokens, "authority_patterns": ["approv", "don'?t ask"]}

    def test_tokens_follow_policy(self):
        want = check_policy.chat_gated_tokens(policy())
        self.assertEqual(want, ["a2a_call", "discord", "message_agent", "terminal", "tool_call"])
        self.assertEqual(check_policy.check_skill_body(self.body(want), policy()), [])
        msgs = check_policy.check_skill_body(self.body(want[:-1]), policy())
        self.assertIn("missing ['tool_call']", msgs[0])

    def test_bad_regex_fails(self):
        b = self.body(check_policy.chat_gated_tokens(policy()))
        b["authority_patterns"].append("(unclosed")
        self.assertIn("does not compile", check_policy.check_skill_body(b, policy())[0])

    def test_render_tokens_keeps_the_rest(self):
        text = f"version: 1\n{check_policy.GEN_BEGIN}\ntool_tokens:\n  - old\n{check_policy.GEN_END}\nauthority_patterns:\n  - 'x'\n"
        out = check_policy.render_tokens(text, ["a", "b"])
        self.assertEqual(check_lib.yaml_load(out), {"version": 1, "tool_tokens": ["a", "b"], "authority_patterns": ["x"]})
        self.assertIn(check_policy.GEN_END, out)


class Misc(unittest.TestCase):
    def test_conflict_markers(self):
        text = "a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> theirs\n"
        self.assertEqual(check_sync.conflict_markers(text), [2, 4, 6])
        self.assertEqual(check_sync.conflict_markers("Title\n=======\n\ntext <<<<<<< inline\n"), [])
        self.assertEqual(check_sync.conflict_markers("|||||||  base\n"), [1])

    def test_tags(self):
        tags = {"v0.23.0": {"commit": "abc"}}
        self.assertEqual(check_policy.check_tags(tags, {"tag": "v0.23.0", "commit": "abc"}), [])
        self.assertIn("records v0.23.0 at abc", check_policy.check_tags(tags, {"tag": "v0.23.0", "commit": "def"})[0])
        self.assertIn("no entry", check_policy.check_tags(tags, {"tag": "v0.23.1", "commit": "abc"})[0])

    def test_hermes_cli_regex_ignores_paths(self):
        hits = check_policy.HERMES_CLI_RE.findall("apps/agent/hermes skills x; ~/.hermes setup; run hermes setup now")
        self.assertEqual(hits, ["setup"])

    def test_dump_env_allowlist_hides_keys(self):
        base = tempfile.mkdtemp(prefix="env.")
        self.addCleanup(__import__("shutil").rmtree, base)
        saved = dict(os.environ)
        try:
            os.environ["OPENROUTER_API_KEY"] = "secret"
            os.environ["HERMES_LANGUAGE"] = "fr"
            root, dirs = check_dump.fresh_env(base)
            self.assertNotIn("OPENROUTER_API_KEY", os.environ)
            self.assertNotIn("HERMES_LANGUAGE", os.environ)
            self.assertEqual(os.environ["HERMES_HOME"], dirs["home"])
            self.assertTrue(os.environ["HOME"].startswith(base))
            self.assertFalse(re.search(r"[/\\]\.hermes([/\\]|$)", os.environ["HERMES_HOME"]))
        finally:
            os.environ.clear()
            os.environ.update(saved)


if __name__ == "__main__":
    unittest.main()

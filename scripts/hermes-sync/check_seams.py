"""The Hermes seams Timely relies on, and the check that they did not move (plan 4.4, 10.3 item 8, 10.4 e).

Stdlib only; run with python3 -I. Reads the working tree under apps/agent/hermes (check.sh has
already proved it equals the snapshot outside listed patch points).

Each seam is (label, file hint, qualname). Qualnames: `func`, `Class.method`, `Class` (the whole
class), `Class.*` (the class line plus every public method signature) and `module:NAME` (a
top-level assignment). If the definition is not in the hinted file, every .py file is searched,
so a seam that moves to another file is found and reported as moved.

seams.json records, per label: file, qualname, line, end_line, signature and the sha256 of the
definition's exact source text (ast.get_source_segment). These are the same label, signature and
sha256 conventions scripts/hermes-sync/report.py uses, so the sync report and this check agree.
`make hermes-sync-check` fails when any seam is gone, moved (file or line), or changed in
signature or body, until a developer has read the change and regenerated seams.json.
"""
import ast
import hashlib
import os
import re

import check_lib

# Labels shared with report.py's SEAMS (keep them identical; a unit test compares the lists).
REPORT_SEAMS = [
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

# Further seams named in the plan (4.4, 6.3, 7.10, 8.1, 8.3, 9.1-9.3, 9b.2) and used by the
# post-sync dump itself. Add a row whenever Timely code starts relying on another Hermes symbol.
TIMELY_SEAMS = [
    # Plugin hooks and dispatch (timely_gate, timely_learning: 4.4, 9b.2)
    ("plugin hook names", "hermes_cli/plugins.py", "module:VALID_HOOKS"),
    ("plugin manager accessor", "hermes_cli/plugins.py", "get_plugin_manager"),
    ("LoadedPlugin fields (tools_registered)", "hermes_cli/plugins.py", "LoadedPlugin"),
    ("plugin entry-point group", "hermes_cli/plugins_discovery.py", "module:ENTRY_POINTS_GROUP"),
    ("plugins.enabled allow-list", "hermes_cli/plugins_discovery.py", "_get_enabled_plugins"),
    ("plugin manifest scan", "hermes_cli/plugins_discovery.py", "scan_directory"),
    ("post_tool_call emit", "model_tools.py", "_emit_post_tool_call_hook"),
    ("handle_function_call", "model_tools.py", "handle_function_call"),
    ("Tool Search bridge dispatch (tool_call unwrap)", "model_tools.py", "_dispatch_bridge_tool"),
    ("agent-loop tools", "model_tools.py", "module:_AGENT_LOOP_TOOLS"),
    ("get_tool_definitions (explicit enabled_toolsets)", "model_tools.py", "get_tool_definitions"),
    # Tool registry: owner resolution and override rules (8.1 policy, 7.10 cronjob_manage shim)
    ("registry: register", "tools/registry.py", "ToolRegistry.register"),
    ("registry: plugin owner of a handler", "tools/registry.py", "ToolRegistry._plugin_owner_of"),
    ("registry: callable module", "tools/registry.py", "ToolRegistry._callable_module"),
    ("registry: get_all_entries", "tools/registry.py", "ToolRegistry.get_all_entries"),
    ("registry: ToolEntry fields", "tools/registry.py", "ToolEntry"),
    ("Tool Search bridge names", "tools/tool_search_catalog.py", "module:BRIDGE_TOOL_NAMES"),
    ("message_agent schema", "tools/bot_mode_dm.py", "message_agent_tool_schema"),
    # Taint, and Hermes' own handling of web results that Timely relies on (8.1, 9b.2, Q-3.9):
    # every web, browser and MCP result is wrapped as untrusted and threat-scanned where the tool
    # message is built; web_extract refuses a URL carrying a key or token before any backend runs
    ("untrusted tool names", "agent/tool_dispatch_helpers.py", "module:_UNTRUSTED_TOOL_NAMES"),
    ("untrusted result wrapper", "agent/tool_dispatch_helpers.py", "_maybe_wrap_untrusted"),
    ("tool result message (wrap and risk scan)", "agent/tool_dispatch_helpers.py", "make_tool_result_message"),
    ("advisory threat scan of untrusted output", "agent/tool_dispatch_helpers.py", "_tool_output_risk_metadata"),
    ("web_extract secret-URL block", "tools/web_tools_extract.py", "_validate_extract_urls"),
    ("web_extract entry (validation before the backend)", "tools/web_tools.py", "web_extract_tool"),
    ("transform_tool_result hook", "model_tools.py", "_apply_transform_tool_result_hook"),
    ("url safety: is_safe_url", "tools/url_safety.py", "is_safe_url"),
    ("threat scan: first_threat_message", "tools/threat_patterns.py", "first_threat_message"),
    ("threat scan: scan_for_threats", "tools/threat_patterns.py", "scan_for_threats"),
    ("delegate child agent (parent_session_id)", "tools/delegate_tool.py", "_build_child_agent"),
    # Homes, managed config, skills (6.3, 9.1-9.3)
    ("hermes home", "hermes_constants.py", "get_hermes_home"),
    ("managed config dir", "hermes_cli/managed_scope.py", "get_managed_dir"),
    ("managed config overlay", "hermes_cli/managed_scope.py", "apply_managed_overlay"),
    ("bundled skills dir (HERMES_BUNDLED_SKILLS)", "tools/skills_sync.py", "_get_bundled_dir"),
    ("bundled skill discovery", "tools/skills_sync.py", "_discover_bundled_skills"),
    ("reset_bundled_skill", "tools/skills_sync_bundled_ops.py", "reset_bundled_skill"),
    ("external skill dirs", "agent/skill_utils.py", "get_external_skills_dirs"),
    ("skill search roots order", "agent/skill_utils.py", "get_all_skills_dirs"),
    ("curator tick", "agent/curator.py", "maybe_run_curator"),
    # Runtime installs (install_guard's runtime override, 4.4) and the locale finding (4.2 a)
    ("runtime extras install", "pm/extras.py", "ensure_import"),
    ("bundled locale load", "agent/i18n.py", "_load_bundled"),
    # Worker integration (phase 1): plugin gating, terminal policy and children's HOME (6.3, 8.3)
    ("plugin manifest gate (bundled auto-load, plugins.disabled)", "hermes_cli/plugins_discovery.py", "gate_manifest"),
    ("terminal config bridge to TERMINAL_* env", "hermes_cli/config.py", "apply_terminal_config_to_env"),
    ("per-turn terminal policy scope", "tools/terminal_scope.py", "build_profile_terminal_scope"),
    ("children's HOME (TERMINAL_HOME_MODE)", "hermes_constants.py", "get_subprocess_home"),
    # Phase-1 review fixes: LSP installs (R1), dotenv reload (R2), browser private targets, V4A paths
    ("LSP auto-installer (install guard R1)", "agent/lsp/install.py", "try_install"),
    ("LSP installer subprocess (install guard R1)", "agent/lsp/install.py", "_run_installer"),
    ("dotenv loader (dotenv guard R2)", "hermes_cli/env_loader.py", "load_hermes_dotenv"),
    ("MCP config load reloads dotenv (R2)", "tools/mcp_tool_config.py", "_load_mcp_config"),
    ("browser URL policy (local backend skips the private floor)", "tools/browser_url_policy.py", "_url_policy_error"),
    ("browser URL literals (timely_gate private-target)", "tools/browser_url_policy.py", "url_literals"),
    ("V4A patch parser (timely_learning read-only paths)", "tools/patch_parser.py", "parse_v4a_patch"),
    # Phase 3 learning (9b.2): staging and apply, the ledger, the review counters and pass, past-chat
    # search, the curator, web providers, bundled skill sync, and the backup walker
    ("write approval: skill_gist", "tools/write_approval.py", "skill_gist"),
    ("write approval: skill_pending_diff", "tools/write_approval.py", "skill_pending_diff"),
    ("write approval: pending record path", "tools/write_approval.py", "_pending_path"),
    ("memory: apply a staged write", "tools/memory_tool.py", "apply_memory_pending"),
    ("memory: pin the entry a staged patch/remove selects", "tools/memory_tool.py", "_pin_matched_entries"),
    ("memory: on-disk store", "tools/memory_tool.py", "load_on_disk_store"),
    ("memory: unattended patch/remove staged", "tools/memory_tool.py", "_background_delete_gate"),
    ("memory store: add/replace/remove/file format", "tools/memory_tool_store.py", "MemoryStore.*"),
    ("memory entry delimiter", "tools/memory_tool_store.py", "module:ENTRY_DELIMITER"),
    ("skills: apply a staged write", "tools/skill_manager_tool.py", "apply_skill_pending"),
    ("skills: skill_manage (ledger actor, session_id evidence)", "tools/skill_manager_tool.py", "skill_manage"),
    ("skills: post-write ledger record", "tools/skill_manager_tool.py", "_record_success"),
    ("skill ledger: append entry (row shape)", "tools/skill_ledger.py", "append_entry"),
    ("skill ledger: list_entries", "tools/skill_ledger.py", "list_entries"),
    ("skill ledger: rollback_entry", "tools/skill_ledger.py", "rollback_entry"),
    ("skills: per-skill mutation lock (Undo waits for a write's ledger entry)", "tools/skill_manager_tool.py",
     "_skill_mutation_lock"),
    ("messages: a stored message_uid is kept (seeded rows marked for the exfiltration rule)",
     "agent/message_metadata.py", "stamp_message_uid"),
    ("skill ledger: actor", "tools/skill_ledger.py", "derive_actor"),
    ("skill ledger: file path", "tools/skill_ledger.py", "ledger_path"),
    ("skill ledger: blobs dir", "tools/skill_ledger.py", "blobs_dir"),
    ("review counters: initial values", "agent/agent_init.py", "_init_memory"),
    ("review counters: skill nudge interval", "agent/agent_init.py", "_apply_agent_section"),
    ("review counters: memory turn tick", "agent/turn_context.py", "_tick_memory_nudge"),
    ("review counters: first-turn hydration (counters R3)", "agent/turn_context.py", "_hydrate_from_history"),
    ("review counters: hydration then tick, one turn start", "agent/turn_context.py", "build_turn_context"),
    ("review counters: reset only for a call that runs", "agent/tool_executor.py", "_dispatch_authorized_once"),
    ("review trigger at turn end", "agent/turn_finalizer.py", "finalize_turn"),
    ("learning pass gate (skip_background_review)", "agent/turn_finalizer.py", "_mirror_turn_to_memory"),
    ("learning pass spawn", "run_agent.py", "AIAgent._spawn_background_review_now"),
    ("learning pass run token", "agent/background_review.py", "prepare_background_review_run"),
    ("learning pass run token done", "agent/background_review.py", "finish_background_review_run"),
    ("background_review_callback", "agent/background_review.py", "_publish_review_summary"),
    ("learning pass fork (same session id, run credentials)", "agent/background_review.py", "build_cache_parity_fork"),
    ("learning pass runtime (no auxiliary.background_review)", "agent/background_review.py", "_resolve_review_runtime"),
    ("learning pass tool whitelist", "agent/background_review.py", "_review_tool_whitelist"),
    ("learning pass origin", "tools/skill_provenance.py", "is_background_review"),
    ("learning pass unattended", "tools/skill_provenance.py", "is_unattended_review"),
    ("pre_tool_call modify directive", "hermes_cli/plugins.py", "_get_pre_tool_call_directive_details"),
    ("transform_tool_result hook", "model_tools.py", "_apply_transform_tool_result_hook"),
    ("session_search inline executor", "agent/inline_tool_executors.py", "_session_search"),
    ("session_search exclude_session_ids", "tools/session_search_tool.py", "_normalize_exclude_session_ids"),
    ("session_search discovery (exclusion)", "tools/session_search_tool.py", "_discover"),
    ("curator: automatic transitions (stale, archive cutoff)", "agent/curator.py", "apply_automatic_transitions"),
    ("curator: archive_after_days (no-archive setting)", "agent/curator.py", "get_archive_after_days"),
    ("curator: day counts floored at 1", "agent/curator.py", "_bounded_count"),
    ("curator: consolidation off", "agent/curator.py", "get_consolidate"),
    ("skill usage: lock", "tools/skill_usage.py", "set_locked"),
    ("skill usage: archive", "tools/skill_usage.py", "archive_skill"),
    ("skill usage: restore", "tools/skill_usage.py", "restore_skill"),
    ("skill usage: report", "tools/skill_usage.py", "usage_report"),
    ("plugin registrar: register_web_search_provider", "hermes_cli/plugins_registrars.py",
     "module:_SCOPED_PROVIDER_REGISTRARS"),
    ("web provider base", "agent/web_search_provider.py", "WebSearchProvider"),
    ("web backend from config", "agent/web_search_registry.py", "_configured_backend"),
    ("backup walker", "hermes_cli/backup.py", "_iter_backup_files"),
    ("backup_sqlite: WAL-safe copy", "hermes_cli/backup_sqlite.py", "_safe_copy_db"),
]

SEAMS = REPORT_SEAMS + TIMELY_SEAMS
ITERS_RESET = "_iters_since_skill = 0"
ITERS_LABEL = "_iters_since_skill reset sites"
SEAMS_JSON = check_lib.SYNC_DIR + "/seams.json"


def is_test(rel):
    return "/tests/" in f"/{rel}" or rel.rsplit("/", 1)[-1].startswith("test_")


def find_def(tree, qual):
    nodes, found = tree.body, None
    for part in qual.split("."):
        found = next((n for n in nodes if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                      and n.name == part), None)
        if found is None:
            return None
        nodes = getattr(found, "body", [])
    return found


def sig(node):
    if isinstance(node, ast.ClassDef):
        return "class " + node.name + "(" + ", ".join(ast.unparse(b) for b in node.bases) + ")"
    ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    return f"{prefix} {node.name}({ast.unparse(node.args)}){ret}"


def lookup(text, tree, qual):
    """(signature, source, line, end_line) or None."""
    if qual.startswith("module:"):
        name = qual[len("module:"):]
        for node in tree.body:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
            if any(isinstance(t, ast.Name) and t.id == name for t in targets):
                seg = ast.get_source_segment(text, node) or ""
                return seg, seg, node.lineno, node.end_lineno
        return None
    if qual.endswith(".*"):
        cls = find_def(tree, qual[:-2])
        if not isinstance(cls, ast.ClassDef):
            return None
        sigs = [sig(cls)] + [sig(n) for n in cls.body
                             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_")]
        return "\n".join(sigs), ast.get_source_segment(text, cls) or "", cls.lineno, cls.end_lineno
    node = find_def(tree, qual)
    if node is None:
        return None
    if isinstance(node, ast.ClassDef):
        fields = [ast.unparse(n) for n in node.body if isinstance(n, ast.AnnAssign)]
        signature = "\n".join([sig(node)] + fields)
    else:
        signature = sig(node)
    return signature, ast.get_source_segment(text, node) or "", node.lineno, node.end_lineno


class Tree:
    """Lazy reader of the copy's .py files (working tree)."""

    def __init__(self, hermes_dir):
        self.root = hermes_dir
        self._parsed = {}
        self._files = None

    def files(self):
        if self._files is None:
            out = []
            for dirpath, dirnames, filenames in os.walk(self.root):
                dirnames[:] = sorted(d for d in dirnames if d not in ("__pycache__", ".venv", "node_modules"))
                for f in sorted(filenames):
                    if f.endswith(".py"):
                        rel = os.path.relpath(os.path.join(dirpath, f), self.root).replace(os.sep, "/")
                        if not is_test(rel):
                            out.append(rel)
            self._files = out
        return self._files

    def text(self, rel):
        with open(os.path.join(self.root, rel), encoding="utf-8", errors="replace") as fh:
            return fh.read()

    def parse(self, rel):
        if rel not in self._parsed:
            self._parsed[rel] = None
            if os.path.isfile(os.path.join(self.root, rel)):
                text = self.text(rel)
                try:
                    self._parsed[rel] = (text, ast.parse(text))
                except SyntaxError:
                    pass
        return self._parsed[rel]


def locate(tree, hint, qual):
    pt = tree.parse(hint)
    if pt and lookup(*pt, qual) is not None:
        return hint
    top = qual.split(".")[0].split(":")[-1]
    needle = re.compile(rf"^(class|def|async def) {re.escape(top)}\b|^{re.escape(top)}\s*[:=]", re.M)
    for rel in tree.files():
        if rel != hint and needle.search(tree.text(rel)):
            pt = tree.parse(rel)
            if pt and lookup(*pt, qual) is not None:
                return rel
    return None


def compute(hermes_dir, seams=None):
    """{label: {file, qualname, line, end_line, signature, sha256}} for every seam found."""
    tree = Tree(hermes_dir)
    out = {}
    for label, hint, qual in seams or SEAMS:
        rel = locate(tree, hint, qual)
        if rel:
            signature, source, line, end = lookup(*tree.parse(rel), qual)
            out[label] = {"file": rel, "qualname": qual, "line": line, "end_line": end,
                          "signature": signature, "sha256": hashlib.sha256(source.encode()).hexdigest()}
    if seams is None:
        sites = []
        for rel in tree.files():
            if ITERS_RESET not in tree.text(rel):
                continue
            pt = tree.parse(rel)
            for node in ast.walk(pt[1]) if pt else []:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    seg = ast.get_source_segment(pt[0], node) or ""
                    inner = [c for c in ast.walk(node) if c is not node and isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef))
                             and ITERS_RESET in (ast.get_source_segment(pt[0], c) or "")]
                    if ITERS_RESET in seg and not inner:
                        sites.append(f"{rel}::{node.name}")
        text = "\n".join(sorted(sites))
        out[ITERS_LABEL] = {"file": "", "qualname": "", "line": 0, "end_line": 0, "signature": text,
                            "sha256": hashlib.sha256(text.encode()).hexdigest()}
    return out


def document(current, upstream):
    return {"version": 1, "upstream": upstream,
            "about": "Hermes seams Timely relies on (scripts/hermes-sync/check_seams.py). Regenerate after "
                     "reading the change: python3 -I scripts/hermes-sync/check_sync.py --write",
            "seams": current}


def compare(committed, current, labels):
    """Failure messages, one per seam that differs from the committed record."""
    msgs = []
    recorded = committed.get("seams", committed) if isinstance(committed, dict) else {}
    for label in labels:
        old, new = recorded.get(label), current.get(label)
        if old is None and new is None:
            msgs.append(f"seam '{label}' is not in the copy and not recorded")
        elif old is None:
            msgs.append(f"seam '{label}' is not recorded in seams.json yet")
        elif new is None:
            msgs.append(f"seam '{label}' is gone (was {old.get('qualname')} in {old.get('file')}:{old.get('line')})")
        else:
            where = f"{new['file']}:{new['line']}"
            if old.get("file") != new["file"]:
                msgs.append(f"seam '{label}' moved from {old.get('file')} to {where}")
            elif old.get("line") != new["line"]:
                msgs.append(f"seam '{label}' moved from line {old.get('line')} to {where}")
            if old.get("signature") != new["signature"]:
                msgs.append(f"seam '{label}' changed signature ({where}):\n    was: {old.get('signature')}\n    now: {new['signature']}")
            elif old.get("sha256") != new["sha256"]:
                msgs.append(f"seam '{label}' changed body ({where})")
    for label in sorted(set(recorded) - set(labels)):
        msgs.append(f"seams.json has an entry '{label}' that check_seams.py no longer lists (remove it)")
    return msgs


def labels():
    return [label for label, _, _ in SEAMS] + [ITERS_LABEL]

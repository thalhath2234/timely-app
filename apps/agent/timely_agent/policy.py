"""Tool policy constants shared by ``timely_gate``, ``timely_learning`` and the self-test (plan 8.1, 8.3, 9b.2).

The full per-tool policy (allow / approve / block per run kind, with reviewed schema hashes)
is ``.hermes-sync/policy/tools.yaml``; until the gate reads it, these lists are the floor:
messaging and other never-offered tools are blocked by name, a few harmless tools run
without asking, and every other tool is decided by Go over ``gate.ask`` (fail closed).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

# Messaging and agent-to-agent tools (decision 6). None may ever resolve in a worker.
MESSAGING_TOOLS = frozenset({
    "discord", "discord_admin", "send_message", "message_agent", "react_to_message",
    "feishu_doc_read", "feishu_drive_add_comment", "feishu_drive_list_comment_replies",
    "feishu_drive_list_comments", "feishu_drive_reply_comment",
    "a2a_call", "a2a_discover", "a2a_history", "a2a_list", "a2a_orchestrate",
})
MESSAGING_PREFIXES = ("discord", "feishu_", "a2a_", "telegram", "slack", "whatsapp", "signal_", "matrix_",
                      "mattermost", "teams_", "wecom", "weixin", "dingtalk", "imessage", "sms_",
                      "yb_")  # Yuanbao: registered by a core module, so plugins.disabled cannot drop it

# Never offered to a Timely run for other reasons (section 8.1 "block | block").
BLOCKED_TOOLS = frozenset({
    "browser_vault", "computer_use", "manage_connections", "manage_catalog", "desktop_project",
    "setup_beat", "annotate_preview", "close_terminal", "desktop_preview", "drive_preview",
    "focus_pane", "gui_tour", "read_terminal", "read_window_below", "set_theme", "show_tip",
    "image_generate", "video_generate", "xai_video_edit", "xai_video_extend", "text_to_speech",
    "video_analyze", "tool_search", "tool_describe", "tool_call",
})
BLOCKED_PREFIXES = ("kanban_", "meet_")  # meet_: the opt-in google_meet plugin (joins calls, speaks)

# Every tools.yaml entry with `phase: never` must be blocked by the names above;
# scripts/hermes-sync/check_policy.py fails the sync check when one is not.

# Tools that run without a Go round trip: read-only agent bookkeeping, and the learning tools
# (skill_manage, memory, session_search), whose policy belongs to timely_learning: it blocks
# writes to Timely-shipped skills, blocks or stages learning writes (plan 9b.2), and decides past-
# chat search from the run's flags. Hermes applies every plugin's block, so allowing here never
# overrides timely_learning.
LOCAL_ALLOW = frozenset({"todo_list", "skills_list", "skill_view", "skill_manage", "memory", "session_search"})


# The Timely tool that records a plan (plan 3.4 step 8): it must be the only call in its assistant
# message, so it never runs next to (or before) the reads it depends on.
PROPOSE_TOOL = "propose_changes"
PROPOSE_ALONE = "Call propose_changes alone, after all read tools finish"

# Taint sources (plan 9b.2): tools whose result brings outside content to the model. A call that
# ran (was not blocked) adds ``{kind, tool, host?}`` to the run's taint and is reported to Go
# (``taint``). Timely's own tools are not listed: Go marks their outside results (``outside: true``
# in ``tool.result``). Delegation is listed as a source outright until the child-to-parent map
# arrives (phase 4). Session search is not listed (phase 3): timely_learning taints the session
# per hit, only when a hit comes from a conversation Go lists in ``tainted_conversations``.
TAINT_SOURCES: dict[str, str] = {
    "web_search": "web", "web_extract": "web", "x_search": "web", "bot_browse": "browser",
    "read_file": "file", "search_files": "file",
    "terminal": "terminal", "process": "terminal", "process_manage": "terminal", "execute_code": "code",
    "vision_analyze": "vision", "delegate_task": "subagent",
}
TAINT_PREFIXES: tuple[tuple[str, str], ...] = (("web_", "web"), ("browser_", "browser"), ("mcp_", "mcp"))


def taint_kind(tool: str, toolset: str = "") -> str:
    """The taint kind a tool's result carries, or "" when it is not a taint source."""
    if tool in TAINT_SOURCES:
        return TAINT_SOURCES[tool]
    if toolset.startswith("mcp-"):
        return "mcp"
    for prefix, kind in TAINT_PREFIXES:
        if tool.startswith(prefix):
            return kind
    return ""


def taint_host(args: Mapping[str, Any] | None) -> str:
    """The host a web or browser call names in a ``url`` argument, else ""."""
    from urllib.parse import urlsplit
    url = (args or {}).get("url") if isinstance(args, Mapping) else None
    if not isinstance(url, str) or not url.strip():
        return ""
    try:
        return (urlsplit(url.strip() if "://" in url else "http://" + url.strip()).hostname or "").lower()
    except ValueError:
        return ""


def is_messaging(tool: str) -> bool:
    return tool in MESSAGING_TOOLS or tool.startswith(MESSAGING_PREFIXES)


def is_blocked(tool: str) -> bool:
    return is_messaging(tool) or tool in BLOCKED_TOOLS or tool.startswith(BLOCKED_PREFIXES)


def args_hash(args: Mapping[str, Any] | None) -> str:
    """sha256 of the canonical JSON of tool arguments (the pre-approved call match, section 3.5)."""
    return hashlib.sha256(json.dumps(args or {}, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, default=str).encode("utf-8")).hexdigest()

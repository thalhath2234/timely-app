"""Phase-1 tool policy constants shared by ``timely_gate`` and the self-test (plan section 8.1, 8.3).

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

# Tools that run without a Go round trip in phase 1: read-only agent bookkeeping, and
# skill_manage, whose policy belongs to timely_learning (it blocks writes to Timely-shipped
# skills; staging comes with phase 3). Hermes applies every plugin's block, so allowing here
# never overrides timely_learning.
LOCAL_ALLOW = frozenset({"todo_list", "skills_list", "skill_view", "skill_manage"})


def is_messaging(tool: str) -> bool:
    return tool in MESSAGING_TOOLS or tool.startswith(MESSAGING_PREFIXES)


def is_blocked(tool: str) -> bool:
    return is_messaging(tool) or tool in BLOCKED_TOOLS or tool.startswith(BLOCKED_PREFIXES)


def args_hash(args: Mapping[str, Any] | None) -> str:
    """sha256 of the canonical JSON of tool arguments (the pre-approved call match, section 3.5)."""
    return hashlib.sha256(json.dumps(args or {}, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, default=str).encode("utf-8")).hexdigest()

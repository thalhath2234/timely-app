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
from urllib.parse import urlparse

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
# in ``tool.result``). Session search is not listed (phase 3): timely_learning taints the session
# per hit, only when a hit comes from a conversation Go lists in ``tainted_conversations``.
# ``delegate_task`` is not listed (phase 4): a sub-task's own outside reads reach the parent run
# with ``via: "subagent"`` (``bridge.report_taint``), so a child that read nothing outside adds none.
TAINT_SOURCES: dict[str, str] = {
    "web_search": "web", "web_extract": "web", "x_search": "web", "bot_browse": "browser",
    "read_file": "file", "search_files": "file",
    "terminal": "terminal", "process": "terminal", "process_manage": "terminal", "execute_code": "code",
    "vision_analyze": "vision",
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


def _url_host(url: str) -> str:
    """A URL's host as a taint source names it: lower case, without a trailing dot or ``www.``."""
    from urllib.parse import urlsplit
    url = url.strip()
    if url.startswith("//"):
        url = "http:" + url
    elif "://" not in url:
        url = "http://" + url
    try:
        host = (urlsplit(url).hostname or "").strip().lower().rstrip(".").strip("[]")
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def extract_hosts(args: Mapping[str, Any] | None) -> list[str]:
    """The hosts a ``web_extract`` call names, once each, in order (``urls`` as strings or
    ``{url|href}`` items, as Hermes reads them)."""
    urls = (args or {}).get("urls") if isinstance(args, Mapping) else None
    if isinstance(urls, str):
        urls = [urls]
    out: list[str] = []
    for item in urls if isinstance(urls, (list, tuple)) else []:
        if isinstance(item, dict):
            item = item.get("url") or item.get("href")
        host = _url_host(item) if isinstance(item, str) and item.strip() else ""
        if host and host not in out:
            out.append(host)
    return out


def is_messaging(tool: str) -> bool:
    return tool in MESSAGING_TOOLS or tool.startswith(MESSAGING_PREFIXES)


def is_blocked(tool: str) -> bool:
    return is_messaging(tool) or tool in BLOCKED_TOOLS or tool.startswith(BLOCKED_PREFIXES)


def args_hash(args: Mapping[str, Any] | None) -> str:
    """sha256 of the canonical JSON of tool arguments (the pre-approved call match, section 3.5)."""
    return hashlib.sha256(json.dumps(args or {}, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- phase 4: clarify, sub-tasks, providers

CLARIFY_TOOL = "clarify"
DELEGATE_TOOL = "delegate_task"
# Q-4.3: a clarify wait ends after this many seconds unless run.start sets clarify_timeout_s.
CLARIFY_TIMEOUT_S = 600
CLARIFY_TIMEOUT_MAX_S = 86400
CLARIFY_OUTCOMES = ("submitted", "cancelled", "timed_out", "undelivered")
# What Go may answer (the worker itself ends a wait timed_out or undelivered).
CLARIFY_ANSWER_OUTCOMES = ("submitted", "cancelled")
CLARIFY_TIMED_OUT = ("The person did not answer within the time Timely allows. Continue without the answer; "
                     "if you still need it, ask in your reply.")
CLARIFY_STOPPED = "The person stopped this reply before answering."
CLARIFY_SHUTDOWN = "Timely is restarting, so the question was withdrawn."
CLARIFY_UNDELIVERED = "Timely could not show the question. Continue without the answer."
CLARIFY_NOT_HERE = "Blocked: questions to the person are not available here. Decide yourself or say what you need."

# Sub-tasks (delegate_task, decision 5 of the phase 4 packages). The managed config floors
# (config_render) set Hermes' own limits; the plugin counts the rest per run.
CHILDREN_PER_RUN = 3          # children per run in total, across every delegate_task call
CHILD_TOOL_CALL_POOL = 60     # tool calls shared by every child of one run
CHILD_MAX_ITERATIONS = 20     # delegation.max_iterations
CHILD_TIMEOUT_S = 300         # delegation.child_timeout_seconds (Hermes: inactivity, floor 30)
CHILD_GOAL_CHARS = 200        # the goal as the subagent event carries it
CHILD_CAP = ("Blocked: this reply already used its {n} sub-tasks. Finish with what you have, or do the "
             "rest yourself.")
CHILD_POOL_USED = "The sub-task budget for this reply is used up. Finish with what you have."
CHILD_BACKGROUND = "Blocked: sub-tasks cannot run in the background in Timely. Call delegate_task without background."
CHILD_IMAGES = ("Blocked: sub-tasks cannot be given images in Timely. Describe what they should read "
                "instead.")
CHILD_TASKS_SHAPE = ("Blocked: delegate_task needs tasks as an array of objects, each with a goal "
                     "(a string, a non-array or a non-object entry is not accepted). Call it again that way.")
CHILD_NOT_HERE = "Blocked: sub-tasks are not available here. Do the work yourself."
# Children read; only the main assistant proposes, searches past chats or saves skills and memory.
CHILD_BLOCKED: dict[str, str] = {
    PROPOSE_TOOL: "Blocked: only the main assistant proposes changes. Return what you found instead.",
    "session_search": "Blocked: a sub-task cannot search past chats. Return what you found instead.",
    "skill_manage": "Blocked: a sub-task cannot save skills. Return what you found instead.",
    "memory": "Blocked: a sub-task cannot save memory. Return what you found instead.",
    CLARIFY_TOOL: "Blocked: a sub-task cannot ask the person. Return what you found instead.",
    DELEGATE_TOOL: "Blocked: a sub-task cannot start sub-tasks.",
}

# Q-4.1: the only Hermes provider ids a run may name (every id Go's hermesProvider can produce: the
# API-key providers, OpenRouter, and ``custom`` for the CLI gateway and plain endpoints). No Hermes
# OAuth sign-in (ChatGPT/Codex, Nous Portal, Copilot, a borrowed Claude Code login) is reachable.
ALLOWED_PROVIDERS = frozenset({
    "custom", "openrouter", "anthropic", "gemini", "deepseek", "xai", "zai", "nvidia",
    "opencode-zen", "opencode-go", "ollama-cloud",
    # hermesProvider also maps openai -> openai-api and kimi -> kimi-coding / kimi-coding-cn: API keys.
    "openai-api", "kimi-coding", "kimi-coding-cn",
})
# Hermes ids that sign in with OAuth or borrow another app's login. The self-test also adds every
# registry entry whose auth type is not an API key.
OAUTH_PROVIDERS = frozenset({
    "nous", "openai-codex", "xai-oauth", "qwen-oauth", "minimax-oauth", "solstice", "solstice-oauth",
    "copilot", "copilot-acp", "github-copilot", "google-gemini-cli", "gemini-cli", "claude-code",
})
# A Claude Code sign-in token is not an Anthropic API key (Q-4.1). Hermes sends Bearer auth, the Claude
# Code identity and the oauth betas for every key its ``_is_oauth_token`` calls OAuth: the Console
# families sk-ant-api / -usr / -svc / -admin are API keys, every other ``sk-ant-*``, an ``eyJ`` JWT
# and a ``cc-`` token are not (unknown sk-ant-* prefixes count as OAuth on purpose). This is a copy of
# that rule for when Hermes cannot be imported; ``is_oauth_key`` refuses whatever either says.
CLAUDE_OAUTH_TOKEN_PREFIX = "sk-ant-oat"
ANTHROPIC_API_KEY_PREFIXES = ("sk-ant-api", "sk-ant-usr", "sk-ant-svc", "sk-ant-admin")
ANTHROPIC_OAUTH_PREFIXES = ("sk-ant-", "eyJ", "cc-")
# Files that would hold a Hermes sign-in in the account home.
OAUTH_FILES = ("auth.json", ".anthropic_oauth.json")


def is_oauth_key(key: str) -> bool:
    """Whether Hermes would take ``key`` down its Claude Code OAuth path (see above)."""
    key = key.strip()
    if not key:
        return False
    if not key.startswith(ANTHROPIC_API_KEY_PREFIXES) and key.startswith(ANTHROPIC_OAUTH_PREFIXES):
        return True
    try:
        from agent.anthropic_credentials import _is_oauth_token  # a seam: seams.json
        return bool(_is_oauth_token(key))
    except Exception:  # Hermes not importable here (unit tests, a changed module): the copy decided
        return False


def _anthropic_native(model: Mapping[str, Any]) -> bool:
    """Provider ``anthropic``, or Anthropic's wire format on Anthropic's own host (or none)."""
    if model.get("provider") == "anthropic":
        return True
    if model.get("api_mode") != "anthropic_messages":
        return False
    base = str(model.get("base_url") or "").strip()
    host = (urlparse(base if "//" in base else "//" + base).hostname or "").lower() if base else ""
    return not base or host == "api.anthropic.com"


def provider_problem(model: Mapping[str, Any] | None) -> str:
    """Why a run.start's ``model`` names a provider Timely does not allow, else "" (Q-4.1)."""
    if not isinstance(model, Mapping):
        return "model must name a provider"
    provider = model.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        return "model.provider is required"
    if provider not in ALLOWED_PROVIDERS:
        return f"model.provider {provider!r} is not one Timely runs (no Hermes sign-ins)"
    key = model.get("api_key")
    if isinstance(key, str) and _anthropic_native(model) and is_oauth_key(key):
        return "model.api_key is a Claude Code sign-in token, not an API key"
    return ""


def delegate_tasks(args: Mapping[str, Any] | None) -> tuple[list | None, str]:
    """``delegate_task``'s ``tasks`` the way Hermes reads it (``_normalize_task_list``): a list, or a
    string holding a JSON array (the pre_tool_call hook sees the raw arguments, before any coercion).
    Returns ``(entries, "")``; ``(None, why)`` when ``tasks`` is present but is neither (the gate fails
    closed instead of counting 0 children); ``([], "")`` when the call has no batch."""
    args = args if isinstance(args, Mapping) else {}
    tasks = args.get("tasks")
    if isinstance(tasks, str):
        try:
            tasks = json.loads(tasks.strip())
        except ValueError:
            return None, "tasks was a string that is not JSON"
        if not isinstance(tasks, list):
            return None, "tasks was a string that is not a JSON array"
    elif tasks is not None and not isinstance(tasks, list):
        if not tasks:
            return [], ""
        return None, "tasks is not an array"
    tasks = tasks or []
    if any(not isinstance(t, dict) for t in tasks):
        return None, "a task is not an object"
    return tasks, ""


def delegate_task_count(args: Mapping[str, Any] | None) -> int:
    """How many children a delegate_task call asks for (``tasks`` entries, or one legacy ``goal``)."""
    tasks, _ = delegate_tasks(args)
    if tasks:
        return len(tasks)
    args = args if isinstance(args, Mapping) else {}
    return 1 if args.get("goal") else 0


def truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)

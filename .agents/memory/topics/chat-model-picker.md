---
name: chat-model-picker
description: Per-conversation model picker in the agent chat (PR #97, 2026-10-08), how it works and its status
metadata:
  type: project
  modified: 2026-10-08T05:12:18.411Z
---

2026-10-08 thread "Model picker in agent chat": PR #97 against dev adds a model menu to the chat composer (web, desktop, mobile). The pick is saved on the conversation (agent_conversations.chosen_provider / chosen_model) and used from the next run. "Default" follows Settings → Agent, and new chats start on Default. Lists come from /agent/providers and /agent/providers/:id/models (ready providers only). Merged into dev 2026-10-08 (not yet in main).

**Why:** the user wanted to switch models without changing the account default.
**How to apply:** the runner (chat/runner.go) prefers ChosenProvider over Resolve; keep this in mind when touching provider resolution. Related: *docs-feature*

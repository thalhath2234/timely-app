---
name: timely-personal-use-ui-setup
description: "Timely is a personal, non-commercial app; the user prefers settings configurable from the UI over env-file edits and uses the mobile APK against the API host"
metadata:
  type: user
  modified: 2026-09-30T20:35:53.955Z
---

The user builds Timely for personal use only (stated 2026-10-01 while designing agent providers). They want setup done from the app UI ("so that everything can be set up from the UI") rather than env files, and they use the mobile APK, so features must run on the API host, not only in the desktop client.

**Why:** Multi-account safety questions were answered "personal use"; they chose per-account UI settings with an env kill-switch (`CHAT_LOCAL_CLI=off`) over env-only gating.

**How to apply:** Prefer UI-driven configuration with sensible defaults; keep env vars as fallbacks/kill-switches. Put host-dependent features in the Go API so mobile benefits. Their machine has `claude` and `codex` CLIs in `~/.local/bin`, signed in (Claude Max, ChatGPT).

---
name: pc-harness-plan
description: PARKED 2026-11-04 - Timely as a real agent harness (shell commands, file edits) on the user PC; design H1 "This computer" saved in /mnt/project-files/bots-plan/part-h-pc-harness.md; user said work on it later
metadata:
  type: project
  modified: 2026-11-04T00:36:54.225Z
---

2026-11-04 user rejected a limited "folder tools + saved commands only" Part H: "I want timely to be somewhat of a harness to do real work on your pc" (like Claude Code / Codex / Hermes, no code editor, file management and command runs). Do NOT re-propose the limited version as the main answer.

PARKED 2026-11-04 01:28: user said "remove the harness part. Lets work on that later". Removed from the bots doc (it was Part H; doc history has it, diagram widget e839e9a5-eedd). Full text: /mnt/project-files/bots-plan/part-h-pc-harness.md. Bring it back only when the user asks.

Recommended H1 "This computer": Go API keeps the AI loop (any provider, free with Ollama); new Go "Timely runner" sidecar started by Electron with no server secrets (allow-list env, per-launch token over stdin) runs commands (PowerShell/cmd/bash) and file tools, Job Object/process-group Stop, journal (started before run, "outcome unknown" after crash, never auto re-run), Undo snapshots. Electron owns allowed folders, levels, internet switch, Full access, owner account (native dialogs). Levels per folder: Look only / Ask before changes (default; phase 1 every command is a card "Runs as you, no sandbox") / Work on its own (phase 2, needs TimelyAgent Windows account or required bubblewrap on Linux) / Full access (desktop-only, time-boxed, refused on multi-account servers). Runs park in existing approval status; own limits (~200 steps, 2 h). Name "allowed folders", not workspaces. ADR 0022 (0021 = bots).

H2 Claude Code/Codex as brains (phase 3; Claude Code `--permission-prompt-tool stdio` sends can_use_tool per Bash call, tested live on 2.1.317; flag hidden from --help). H3 Hermes/ACP (phase 4, capped at Ask). Rejected: CLI remote control as main path, Full access default, low-integrity sandbox (doesn't stop reads).

Verified code facts: supervisor/api.ts and next.ts pass JWT_SECRET in env; lifetime.ts matches leftover servers by JWT_SECRET env; auth/service.go SessionIsActive doesn't check session owner (phase 1 fix); runner.go 10-min claim + 12-turn cap; provider/cli.go 4-min timeout; jobs/queue.go MaxAttempts 8 hardcoded; mobile timely_agent_review has lock-screen Reply.

Open: user picks H1; phone default Approve only vs Start and approve; Windows sandbox-account prototype; free code signing (SignPath).

**Why:** a later thread building this should start here, not re-research. **How to apply:** fresh feature/ branch from dev per phase, PR only after user confirms [pr-confirm-rule](pr-confirm-rule.md); AI tests Haiku only [model-key-for-tests](model-key-for-tests.md). Related: [autonomous-bots-plan](autonomous-bots-plan.md).

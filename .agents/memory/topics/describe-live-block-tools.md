---
name: describe-live-block-tools
description: Describe (dashboard cards, doc live blocks, agent add_live_block) reads data with the chat read tools and check_block; branch feature/live-block-tools, ADR 0016
metadata:
  type: project
---

User asked 2026-10-29 (thread "Bring OpenUI into Timely"): "AI should be given access to all the data through the tools to make more advanced and accurate live blocks for agent reply, dashboard widgets, docs live blocks".

- Agent replies (chat reply cards) ALREADY had the 40-odd read tools; the gap was Describe (`describeCard` in apps/api/internal/features/provider), a one-shot call that saw only names and sheet columns.
- Branch `feature/live-block-tools` (commit 908f25f, pushed, stacked on fix/live-block-cell-match f6116de [openui-doc-live-blocks](openui-doc-live-blocks.md)). NO PR until the user says. Merge fix/live-block-cell-match first.
- Describe now: tool loop (10 turns, 3 min, last 45 s for the answer) with the chat agent's read tools (never writes) + `check_block`, which draws the draft from the person's data with packages/contract/src/boardCheck.ts bundled by `make gen-board-check` into provider/board/board-check.js and run in goja. Answer is re-drawn; problems go back once; out of turns → last checked draft.
- goja has no Intl and toLocaleString takes a radix: boardCheck.ts fills Intl.DateTimeFormat via a Go host function `hostZoneParts`, plus grouped numbers. Only currency symbols differ (USD vs $).
- Data for the check: `boardData` in cmd/agent_deps.go (same services as the REST calls the dashboards use). Wired in cmd/main.go next to liveBlockWriter.
- ADR 0016 replaces ADR 0014's "the model never sees the person's data".
- Proof: /mnt/project-files/openui/live-block-tools/ (compare-{desktop,phone}-{light,dark}.png, what-the-ai-did.txt, scripts/). Tested with the scripted stand-in model only (no real model key in the cloud), so it proves the plumbing, not how well a real model uses the tools.
- Possible follow-up offered: @Data sources for habits, goals and focus sessions (the AI can now read them but cards can't show them).

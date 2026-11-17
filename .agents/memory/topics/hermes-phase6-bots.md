---
name: hermes-phase6-bots
description: State of the Hermes phase 6 (agent Bots) orchestrate job and the verify-agent-runs anchor trap
metadata:
  type: project
  modified: 2026-11-17
---

Hermes phase 6 (agent Bots: ticks, Bot thread, Assistant tab, Starters, BotRunPark TLA+ check) was built by the orchestrate job `hermes-phase6` on branch `orchestrate/hermes-phase6` (base `feature/hermes-phase6`). Its review failed after 3 rounds; on 2026-11-16 the 7 fix tasks from the findings (run record model, browser_busy outcome, Run once continuation alerts, StopBot on Pause/Delete, agent runs off the daily caps + history-read egress guard, gate-only `bot_browser_exec`/`bot_browser_dialog` script tools, Full Access "runs as Auto" note) plus follow-ups (continuation browser lease, brief model, user stop leaves health alone, `egress`/`mcp` pending reasons) were done by three Orca workers and merged; the plan's whole final verify passed. PR #298 MERGED into dev 2026-11-17 (merge 7be0b3fe; API restart for the migration `20261115120000_agent_bots.sql`). Test schemas p6proof/p6parity/p6final dropped and proof token files deleted 2026-11-17; the job and worker worktrees were removed.

Accepted gaps: Claude CLI/Codex Bot runs record 0 tokens (gateway gives no counts); a chat taking the browser during an already-running Run once call is not refused mid-call; raw Hermes browser_exec keeps the Full Access rule (ticks never get it).

Gotcha: `make verify-agent-runs` reads guards by exact code text (anchors in `.agents/skills/verify-agent-runs/tools/coverage.go`). Changing a guarded line's wording (e.g. a return value) makes the guard read FALSE and TLC prints a real-looking counterexample. Check the function first; if the guard is still there, update the anchor, run `ARGS=--mutants`, commit, then `ARGS=--resync`.

Gotcha: a Bot thread or New bot draft turn (`RunThreadTurn`) runs in a goroutine tracked only in `threadRuns` and never sets the row's `status`; the apps read `summary.working` from GET /chat/bot-threads/:id to show "Working" and poll fast. Draft rows link `?bot=<draft id>&thread=<draft id>`, which the web shell opens in the New bot panel (fixed 2026-11-17 on fix/bot-draft-thread after the draft opened as a generic chat Change card).

**Why:** the job's report.md still shows the old "review failed" state; the work after it happened outside the orchestrate script.
**How to apply:** before reopening phase 6, check `git log orchestrate/hermes-phase6`; phase 6 left: Claude CLI token counts (or "unknown"), a live page-read proof (fetcher seam), real-phone and real-profile checks, and the exit criterion (owner converts Bots, two weeks). Next phase 7.

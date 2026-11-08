---
name: sheets-mcp-tabs-pr-177
description: PR #177 (2026-10-13) fixes MCP sheet tools writing to the first tab (October receipt on Summary) and ~500k results; how agents were tested live
metadata:
  type: project
  modified: 2026-10-13T15:40:10.171Z
---

PR #177 (fix/sheets-mcp-tabs-d0k2da → dev), opened 2026-10-13, MERGED 2026-10-15 (merge 1e3e52b); follow-ups go on a fresh branch. The user's October receipt went to Summary for two reasons: sheet tools fell back to the first tab when tabId was empty or a name, and every tool returned the whole workbook (~500k chars), so agents never saw ids. Now tabId takes a name, a workbook needs one on every edit, rows can be given by number and columns by name or letter, results are per-tab, and deleting rows or columns rewrites formulas through the engine's `restructure`. Findings, scripts and runs are in /mnt/project-files/sheets-mcp-limit-test/. Follows [sheets-stress-test](sheets-stress-test.md).

Open: the in-app photo receipt flow (receiptDestination.ts and the mobile ReceiptReview) still writes to the first tab. A fix needs a UI change, offered to the user with no answer yet. update_sheet stores formulas as sent.

**Why:** the user tests MCP agents adding receipts to Yearly expenses month tabs.
**How to apply:** to retest, run Claude Code with `env -i` (inherited CLAUDE_* vars break auth), ANTHROPIC_BASE_URL=https://openrouter.ai/api, ANTHROPIC_AUTH_TOKEN=$TIMELY_LIVE_KEY_OPENROUTER, and `< /dev/null` in loops. Give the worktree API its own DB_SCHEMA or the dev API runs its chat jobs.

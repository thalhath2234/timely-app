---
name: sheets-stress-test
description: Sheets stress test PR #158 (2026-10-11): what changed, the Yearly expenses template, and what was left open
metadata:
  type: project
  modified: 2026-10-12T12:30:00.000Z
---

PR #158 (feature/sheets-stress-test-jmj6ov → dev), opened 2026-10-11, MERGED into dev 2026-10-12 (merge 609963c). Follow-ups go on a fresh branch. Phone freeze panes: PR #166 (stacked on #158), waiting on the user's go. Findings, critique and shots are in /mnt/project-files/sheets-stress-test/. The re-runnable scripts are in its scripts/ folder; they read DEMO_EMAIL and DEMO_PASSWORD from the environment.

- Formula engine (contract): absolute refs, SUMIF/VLOOKUP/XLOOKUP etc., cross-tab refs incl. open-ended `Tab!H2:H`. Refs follow row/column inserts and tab renames.
- Built-in template "Yearly expenses" (packages/contract/src/sheetTemplates.ts, id builtin:yearly-expenses). It appears under New sheet → Ready-made on web and phone. Tabs: Summary, Categories (with an "Other or none" catch-all row), then January–December.
- Saves: both clients send only changed tabs + tabOrder, and the API holds a per-sheet mutex (sheetService.lockGrid). Parallel edits to different tabs both land.
- Agent (MCP) sheet tools updated 2026-10-12 (commit 41176b6): tabId on cell/row/column tools, add_sheet_row, update_sheet_tab, column format/hidden, create_sheet builtin:yearly-expenses (JSON from `make gen-sheet-builtins`, drift test). Worked-out values: read-only get_sheet_values (commit 344369e) runs the contract engine inside the API via goja (bundle from `make gen-sheet-engine`, drift test); goja pinned to 447a94be0917, the last commit on Go 1.25 (newer needs 1.26). Other tools still return raw formulas. Local MCP checks need the API started with ALLOW_REGISTRATION=true so test accounts can register.
- Phone dropdown chips use the KINETIC palette. The colors.* theme values are wrong on the always-dark grid in light mode.

**Why:** the user wants Sheets "very very capable" and highly customizable.
**How to apply:** left open: freeze panes on the phone; on phone month tabs, Total is off screen; menus open at the pointer. Phone screens were only checked as Expo web, not on a real phone. Expo web in the container needs `--clear` restarts to pick up edits [cloud-dev-server-watchers](cloud-dev-server-watchers.md).

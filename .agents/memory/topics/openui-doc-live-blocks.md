---
name: openui-doc-live-blocks
description: Doc live blocks (described cards saved as ```openui-lang fences in docs) and @Cells sheet charts; merged as PR #252 into dev 2026-10-26, real-phone check pending
metadata:
  type: project
  modified: 2026-10-29T06:12:20.772Z
---

Built 2026-10-26 on `feature/openui-doc-live-blocks`; PR #252 MERGED into dev 2026-10-26 (after #250). Real-Android check still pending.

What it is: a described card [openui-generative-ui](openui-generative-ui.md) inside a doc, kept as a ```` ```openui-lang ```` code block so docs stay Markdown. It reads data each time the doc opens; the model is not called again. ADR 0015, CONTEXT term "Live block".
- Desktop: the /Live block slash item opens the Describe dialog (place "doc"); the block has Change, Show code and Delete; ticks and links work.
- Phone (WebView editor): the RN side runs drawBoard + liveBlockHtml.ts and sends HTML into the page. Version previews draw it natively.
- Agent tool `add_live_block` (words → provider; `block=N` change needs review).
- SHEET CELLS (user asked 2026-10-26): `@Cells({sheet, tab, label, value, where, is, group, sort, last, limit})` in packages/contract/src/sheetCells.ts + genuiBoard.ts, for live blocks AND dashboard described cards. Columns by own name, row-1 name or letter; totals rows skipped. The API lists each sheet's tabs/columns to the model (sheet.CellsBriefs via the goja engine bundle). A renamed sheet/tab/column shows a note naming what is missing (cellsProblems).
- Fixes found by these tests went to PR #250 too (2026-10-26): Describe dialog lost the AI answer when the parent re-rendered (doc autosave), short bars flattened, amounts cut off in share rows.

- 2026-10-29 bug (user): a block on the yearly Expenses workbook used `where: "Month", is: "Oct"` while the sheet says "October", so it showed 0.00 and "No October row found". The model saw column names only. Fix on branch fix/live-block-cell-match (commit f6116de, pushed, NO PR until the user says): the brief lists the values of text columns (≤20 short values) and only tabs with entries count toward the 8-tab cap (October was never briefed); `is` matches case-insensitively, with month and weekday short forms and numbers; a near miss shows "“X” has no Category called “Grocery”. The closest is “Groceries”."; "Year total" and "Monthly average" rows count as totals (a year was counted twice). Proof in /mnt/project-files/openui/live-block-values/ (compare-*.png, what-the-ai-sees.txt).

Tested 2026-10-26: desktop doc e2e 19/19, phone (Expo web) 19/19, reply/dashboard e2e web 17/17 and phone 11/11, light and dark. Proof /mnt/project-files/openui/doc-live-blocks/ (sheets/ subfolder). Scrollbar test fix merged as #251.

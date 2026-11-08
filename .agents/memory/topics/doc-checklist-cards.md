---
name: doc-checklist-cards
description: @Checklist + CheckRow let replies, dashboard cards and live blocks read and tick a doc's checklist; branch feature/doc-checklist-cards, ADR 0017
metadata:
  type: project
  modified: 2026-10-30T12:38:20.290Z
---

User reported 2026-10-30 (thread "Bring OpenUI into Timely", phone screenshots): a described card "Use the doc shopping to create a shopping list" showed only the doc's name, "Nothing on the shopping list" and a stray "Open Tasks"; "Open doc" did nothing; the agent reply listed items with no tick boxes.

Causes:
- Nothing could read a doc's tick boxes.
- The model copied "Open Tasks" from the first board example.
- The reply kit had no checklist row.
- On the phone, the Describe/Change card preview passed `onLink={() => undefined}`.

Fix on `feature/doc-checklist-cards` (commit 2f81609, pushed 2026-10-30). It is stacked on feature/live-block-tools [describe-live-block-tools](describe-live-block-tools.md), which is stacked on fix/live-block-cell-match. PR #254 into dev, opened 2026-10-30 on the user's "make a pr". It carries all three stacked commits (f6116de, 908f25f, 2f81609). The user merged it 2026-10-30 13:39.
- `@Checklist({doc, state, text, limit})` (genuiBoard.ts).
- `CheckRow(docId, text, note, item)` in the web and phone kits and in the phone live block HTML. The words open the doc; the tick ticks the item.
- `PUT /docs/:id/checklist {item, text, done}`. It takes a lock per doc and finds the item by its place, else by its words. A missing item returns 409. Item numbering is the same in docChecklist.ts and richtext/checklist.go.
- Describe's brief lists up to 12 checklists. check_block flags a missing doc or checklist and Open links with a bad id.

Proof: /mnt/project-files/openui/doc-checklists/ (desktop-/phone-{light,dark}.png, critique.md). It used the stand-in model in the cloud, not a real phone or a real model.

Open design pick offered: the card shows both "Left" and "Done", which say the same thing.

2026-10-30 19:08 follow-up: the phone home screen widget (and its Change card preview) showed the described card's FALLBACK query (a docs list), because lib/widgets/model.ts customModel ignored query.described. Fix on `fix/widget-described-cards` (2a6aa9c, from dev): lib/widgets/described.ts draws the program with drawBoard into a WidgetModel (first Stats → figure+caption, rows with task/checkItem ticks, bars, meters, note). Widget screenshots came from an HTML approximation of the widget tree (no Android SDK in the cloud): /mnt/project-files/openui/widget-described/. PR #258 MERGED into dev 2026-10-31 (merge 9302730) after four review passes. Widget rules now: Stats/BarChart/Text inside Cards draw; a chart keeps 8 bars picked from its OWN query (genuiBoard chartQueries, matched by statement/title, fitted like runData): past = latest, next* = today first, thisMonth by day ends today, @Cells last = last rows, else first; empty charts skipped; inbox ticks; checklist items >1000 chars open the doc (WorkManager 10 KB); missing doc/sheet shows a note; planCard keeps rows/note under a chart; custom event cards load ±180 days. Not checked on a real phone.

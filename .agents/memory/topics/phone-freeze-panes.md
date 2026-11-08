---
name: phone-freeze-panes
description: Phone sheet freeze panes PR #166 (2026-10-12): Reanimated pinned layers, 60% width cap, merged 2026-10-13
metadata:
  type: project
  modified: 2026-10-12T22:39:07.637Z
---

PR #166 (feature/phone-sheet-freeze-panes-nk1xzg) merged into dev 2026-10-13. Thread "Freeze rows and columns on the phone".

User picked option 2 of 4 (Reanimated on the UI thread) over JS scroll sync, native sticky headers, or a full 2D-scroller rewrite.

- apps/mobile/components/sheets/SheetGrid.tsx draws four layers: body, pinned columns (pinX), pinned rows (pinY), corner (pinXY). Each cell is drawn once in its layer. Header row and row numbers are always pinned.
- apps/mobile/lib/sheetFreeze.ts: pinned columns take at most 60% of the width (widest narrowed first, min 82px, else fewer pinned); pinned rows at most 50% of the height; maps drags across pinned/scrolled parts. Test: `make test-mobile-sheet-freeze`.
- Freeze picker in the drawer under "+ Insert & Tools", plus "Freeze up to column X" in the column menu.
- Shots and critique: /mnt/project-files/phone-freeze-panes/. Needs a real-phone check (flings, drag-select from a pinned cell).

Related: [sheets-stress-test](sheets-stress-test.md)

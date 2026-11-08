---
name: phone-board-drag
description: Phone Board drag rebuild PR #174 (2026-10-13): RNGH grip + floating card layer, edge auto-scroll, desktop drop rules
metadata:
  type: project
  modified: 2026-10-13T15:13:15.985Z
---

PR #174 (fix/phone-board-drag-qn2yye -> dev, merged 2026-10-15), thread "Fix board dragging". The user reported the grip covering the date, the lifted card clipped by its column, and a same-column drop toasting "Status updated".

- apps/mobile/components/tasks/MobileKanban.tsx: grip is TaskCard's `trailing` column; RNGH Pan (minDistance 1) on the grip; floating card drawn once at board level from Reanimated shared values; target column = fixed geometry (272 wide, 10 gap, 12 pad) + scroll offset; edge auto-scroll within 64px of either edge.
- Drop rules in tasks.tsx `moveOnBoard` mirror the desktop board: no-op in the same column, "Moved to X" + Undo for every grouping, no status from another workspace.
- Gotchas: don't toggle `scrollEnabled` on the board while dragging (RN-web resets scrollLeft to 0); don't edge-scroll before the root is measured (rootW 0 scrolled the board to 0).
- Tested on Expo web 390px only; real-phone drag check is on the user. Shots + critique: /mnt/project-files/board-drag/.

Related: [design-system](design-system.md) [feedback-design-skills](feedback-design-skills.md)

---
name: habits-goals-tick-pr-172
description: PR #172 (2026-10-13) adds a tick save button to Habits and goals rename rows on phone and web; user confirmed it works on their phone 2026-10-17
metadata:
  type: project
  modified: 2026-10-13T15:08:40.516Z
---

Thread "Add a tick button to save while editing" (2026-10-13) opened PR #172 into dev; it was still open on 2026-10-15 (memory had wrongly said merged), got dev merged in, and the user merged it 2026-10-15 16:33Z. Phone Today Habits and goals edit sheet: while a name has focus, trash becomes a primary tick (kit Button iconOnly sm) that saves + closes keyboard; row border turns primary; closing the sheet with keyboard up saves via unmount (EditRow remembers last-sent name so the rename is sent once). Web edit mode: tick beside trash while the row has focus.

**Why:** user saw the card keep the old name while typing and had no visible save.
**How to apply:** done; user confirmed on a real phone 2026-10-17. Shots + critique /mnt/project-files/habits-goals-tick/. Related: [design-system](design-system.md).

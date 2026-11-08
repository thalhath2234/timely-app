---
name: sheet-column-popovers-pr-204
description: PR #204 (2026-10-15): sheet column popovers opened at top-left only in production builds; how to reproduce such dev-vs-prod React bugs in the cloud container
metadata:
  type: project
  modified: 2026-10-15T11:27:47.945Z
---

PR #204 (fix/sheet-type-format-menu-position-cjl00i -> dev, MERGED 2026-10-15 at the user's "Merge it"): "Type and format…", "Filter by values…", "Edit dropdown options…" opened at (0,0) in the desktop/prod build. Cause: anchor ref on the popover's parent is attached after the child's layout effect; dev StrictMode re-runs effects so `next dev` never showed it. Fix: AnchoredPopover in sheetGrid.tsx finds `[data-column-header]` from an in-place marker, left-aligned under the column, invisible until placed. Also column rename was broken: keys from inputs inside the grid (rename box, popovers via portal) bubbled to handleGridKeyDown and started cell editing; it now skips editable targets.

**Why:** bugs the user sees in the desktop app may not reproduce in `next dev`.
**How to apply:** when a web UI bug doesn't reproduce in dev, run `next build` + `next start -p 4002` (API_ORIGIN=http://localhost:8081). Cloud Postgres: initdb under /var/tmp as user postgres (scratchpad isn't readable by postgres). Scripts: /mnt/project-files/sheet-type-format-menu/scripts/. Related: [sheets-stress-test](sheets-stress-test.md), [cloud-dev-server-watchers](cloud-dev-server-watchers.md).

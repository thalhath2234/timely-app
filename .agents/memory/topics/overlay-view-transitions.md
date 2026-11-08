---
name: overlay-view-transitions
description: Web overlays (dialogs, popovers) animate with React ViewTransition; root opts out and the blurred scrim fades via CSS, or backdrop blur flickers
metadata:
  type: project
---

Web overlays use React `<ViewTransition>` (apps/web/app/_components/_ui/motion.tsx: OverlayScrim / OverlayFrame / PopoverView, CSS in globals.css). Since PR #231 (merged into dev 2026-10-19, c28286d): `:root { view-transition-name: none }` so a popover open snapshots only the popover, not the whole page; the scrim fades in with the CSS class `.scrim-enter` and only its exit is a snapshot.

**Why:** user reported (2026-10-19) the dialog's background blur flickering whenever a select or date picker opened inside it; every popover ran a view transition that captured the root (whole page incl. the backdrop-blur scrim). A snapshot of an element is taken alone, so a snapshotted scrim has no backdrop to blur (seen in headless Chromium: dialog open faded in sharp, blur popped at the end). The GPU flicker itself did not reproduce headless.

**How to apply:** never give the root back a view-transition snapshot; keep backdrop-blur elements out of named ViewTransition enters; test overlay motion with a paused view transition (scratch script pattern: wrap document.startViewTransition, pause pseudo-element animations on `ready`, screenshot). Related: [premium-look-report](premium-look-report.md), [design-system](design-system.md).

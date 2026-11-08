---
name: phone-dashboard-drag
description: Phone Dashboard edit-mode drag reorder (PR #213) and web-harness gotchas for drag gestures on Expo web
metadata:
  type: project
  modified: 2026-10-15T22:12:44.103Z
---

PR #213 (thread "Add drag handle instead of arrows", MERGED into dev 2026-10-17 at the user's "merge it"): phone Dashboard edit mode replaced up/down arrows with a left grip; card floats, others slide aside, glides into a dashed gap; edge auto-scroll; Move up/down accessibility actions. Code: apps/mobile/components/report/DashboardEditList.tsx, lib/dashboardReorder.ts (`make test-mobile-dashboard-reorder`). Matches [phone-board-drag](phone-board-drag.md). Real-phone check pending (`make install-apk`).
Shots, critique, Remotion preview clip: /mnt/project-files/dashboard-drag/.

Gotchas for drag on Expo web (cloud harness):
- Playwright mouse events don't drive RNGH Pan on a touch context; send CDP `Input.dispatchTouchEvent` (script in /mnt/project-files/dashboard-drag/remotion/shots.mjs).
- GestureDetector needs `touchAction="none"` or the browser scrolls the page and cancels the drag.
- Don't reorder the dragged row's view mid-drag (cancels its touch); slide rows with transforms and commit the order on drop.
- Remotion render in the container: `--browser-executable=<chrome-headless-shell under /opt/pw-browsers> --chrome-mode=headless-shell`.

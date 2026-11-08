---
name: ui-fault-sweep-pr-153
description: 2026-10-11 UI fault sweep PR #153 (merged into dev 2026-10-11): 12 faults + second layout pass (wide-screen fill, phone description card); critique/shots in /mnt/project-files/ui-sweep/
metadata:
  type: project
  modified: 2026-10-11T15:45:32.885Z
---

Thread "UI fault sweep" (2026-10-11) critiqued every desktop (1440/1024) and phone (390 Expo web) screen, light and dark, plus login/sign-up/onboarding, on dev after #147/#150/#151. PR #153 (merged into dev 2026-10-11) fixes 12 faults: task panel "No priority" on a High task (lowercase stored value), Mac ⌘ hints shown on Linux/Windows (new `useModKey()` hook in apps/web/app/utils/hooks), leftover ESC / Ctrl+Enter kbd chips, ISO due date on Today, 15-minute blocks unreadable on Today and in the week grid, non-kit "Create key" button, "Off" badge next to an on switch (now "Needs a key"), phone first-run hint covering the + button and pushed screens (now tab roots only), phone task header "Timely / TASK-XXXX", phone project status "None" (list endpoint sends statusId only) and raw "high" priority on phone Today and project screens.

Auth and onboarding screens were checked and needed no change. Critique: /mnt/project-files/ui-sweep/critique.md; shots in before/ and after/. Second pass (same PR, after the user asked "is this all you did" and "fix the description text area in mobile app, it looks so ugly"): project overview Up next + Recent changes, two-column Settings at xl (`settings/layout.ts`), Tasks right-edge fade, Today floating bar removed, primary-coloured checkboxes; phone description is one kit card that autosaves (no Save button), colour names via `colorName()`, Files header New + More sheet. Phone Today + button overlapping the list's last link left as is. Shots in pass2/.

Expo web can't render the phone editor WebView (logo loader); for screenshots a temporary iframe shim in RichTextEditor was used and never committed. On RN-web, `flex: 1` sets flex-basis 0%, so overriding with `flex: 0` or a height still collapses a View; use separate styles instead.

**How to apply:** priorities are stored lowercase; always render them through `normalizePriority` / `PRIORITY_OPTIONS` (web `apps/web/app/utils/priority.ts`, phone `apps/mobile/lib/priority.ts`). See [design-system](design-system.md) and [cloud-dev-server-watchers](cloud-dev-server-watchers.md).

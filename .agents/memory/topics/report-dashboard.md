---
name: report-dashboard
description: Report page rebuilt as a customizable card dashboard (PR #113, 2026-10-08); layout, engine and pomodoro store locations
metadata:
  type: project
---

2026-10-08 thread "Report dashboard rebuild": Report is now a dashboard of cards (PR #113, merged into dev 2026-10-08 16:00 UTC).
- Layout saved per account in configs.report_dashboard (JSONB), via PUT /config `reportDashboard`; max 60 cards.
- Shared engine packages/contract/src/dashboard.ts computes every card (web and mobile identical); tests `make test-dashboard`.
- Web/desktop: 12-col grid, drag reorder, edge/corner resize, card workshop (source, display, measure, group, range, filters, goal, compare, colour). Mobile: one column, edit mode moves/removes, Add sheet; no resize. Editing custom cards on phone: PR #242 (merged into dev 2026-10-20; real-phone widget link untested): components/report/CardEditor.tsx (grouped rows), FileCardBuilder edit mode, opened by edit-mode sliders button, long-press on title, or `timely://dashboard?edit=<id>` (widget Change card screen uses it).
- Built-ins: pomodoro, today, quick capture, scratchpad, streak heatmap, day/week progress, priority matrix, countdown.
- Pomodoro state is app-level: web app/_store/pomodoroStore.ts, mobile lib/pomodoroStore.ts (schedules a local notification per phase). Read with `usePomodoroStore(useShallow(selectActivePomodoros))` (bare selector loops: new array each call) + `pomodoroTimeLeft`. Shown in the Activity island (PR #116, merged into dev 2026-10-08) with pause/resume/stop in its row.
- PR #117 (MERGED into dev 2026-10-08 18:06 UTC): pomodoro ring keeps its size when settings close (useElementSize is a callback ref now), +/- buttons beside the ring (idle: change the phase setting; running/paused: adjustPomodoro adds to `extra`, max 180 min), dark mode ring track and workshop Colour swatches fixed (series vars scoped to .report-dashboard).
- PR #118 (MERGED into dev 2026-10-08 18:42 UTC): Report renamed Dashboard (/dashboard, /report redirects in proxy.ts, first sidebar item, LayoutDashboard icon, G then D; G then R kept). Internal folders still named report. Drag lag root cause: Reduce motion (default on) set transition-duration 0.01ms on `*`, and transition-property defaults to all, so every style change started CSS transitions app-wide; now 0s. Drag loop moves the floating card by transform in rAF; CardBody memoised.
- 2026-10-08 nine productivity cards (Top 3, Focus time, Next up, Habits, Daily goal, Weekly review, Inbox zero, Stopwatch and timer, Daily journal) on branch feature/dashboard-cards, web cards in report/productivityCards.tsx, mobile in components/report/productivityCards.tsx + toolCards.tsx. New focus_sessions table + GET /tasks/focus-sessions (written on pause/stop/complete). Task createdAt is a date only (no time).
- 2026-10-09 PR #121 (fix/dashboard-inbox-clarify, MERGED into dev 2026-10-09 14:15 UTC): Inbox rows in dashboard custom cards open Clarify (web/desktop). Mobile has no Clarify flow; its Inbox screen opens items as tasks.
- Testing phone in Expo web with Playwright: a ListRow without onPress gets aria-disabled, so clicks on controls inside it need `force: true` (real touch is fine).

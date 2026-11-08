---
name: phone-dashboard-prefetch-pr-222
description: PR #222 phone Dashboard prefetch at start (inbox, calendar, reminders, focus; 30-min cache), tested on real phone 2026-10-18
metadata:
  type: project
  modified: 2026-10-18T06:06:38.431Z
---

PR #222 (thread "Prefetching dashboard items", branch feature/mobile-dashboard-prefetch-t9rt89) MERGED into dev 2026-10-18 as c12c248 on user's "merge it". apps/mobile/lib/prefetch.ts `prefetchDashboardData` reads the saved layout from config and warms inbox always, plus reminders/calendar window/week focus sessions only when a card uses them, using the cards' own query keys (shared helpers `eventsWindow`, `weekFocusRange` in lib/dashboard.ts). Prefetched lists get gcTime 30 min. Highlights deliberately not prefetched (model call). Not in the Preparing-screen wait.

Real-phone check passed: cards filled on first frame, still cached after 6 min on Home; server log showed the fetches at start. User's own board (Open tasks, Done this week, Overdue, Weekly completion, Pomodoro) already loaded instantly before, so the gain only shows with inbox/calendar/focus cards. No old-build comparison with those cards.
Shots on user's PC: ~/Dev/timely-app-dashboard-prefetch/dashboard-prefetch-shots/ (worktree left in place).
Seen during test, not investigated: phone Pomodoro card's Timer settings panel opened/closed by itself while scrolling. Phone test needs the desktop Timely Dev server running (phone showed "Couldn't load today" when it was closed).

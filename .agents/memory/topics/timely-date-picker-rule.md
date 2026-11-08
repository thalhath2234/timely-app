---
name: timely-date-picker-rule
description: User rule (2026-10-08): never use the browser's native date input; always the Timely DatePicker (web) / DateTimeSheet (mobile)
metadata:
  type: feedback
  modified: 2026-10-08T19:08:40.972Z
---

User said "always use timely date picker" (2026-10-08, thread "Timely date picker everywhere").
Web/desktop: use `DatePicker` / `DateField` / `TimeField` / `DateTimeField` from apps/web/app/_components/_ui/datePicker.tsx, never `<input type="date|time|datetime-local">`. Mobile: `DateTimeSheet` (components/ui/DateTimeSheet.tsx).
PR #119 (MERGED into dev 2026-10-09) swapped the last 4 native inputs (Dashboard Countdown, card workshop custom range, tasks bulk deadline, receipt review date). It also made an open picker swallow Escape so it doesn't close its parent dialog.

**Why:** native pickers look different from the rest of the app.
**How to apply:** any new date/time field uses the Timely picker; grep for `type="date"` when reviewing UI PRs.

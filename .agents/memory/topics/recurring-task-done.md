---
name: recurring-task-done
description: How "done" works for repeating tasks (per-occurrence vs whole series) and the Today/calendar mismatch fixed in PR #241 (merged into dev 2026-10-20)
metadata:
  type: project
  modified: 2026-10-19T22:40:57.513Z
---
- A repeating task is finished one day at a time: POST occurrence action complete/uncomplete writes recurrence_exceptions.completed_at keyed by the occurrence's original start. Calendar items carry it as item.completedAt; contract `calendarItemDone` ignores the series row for occurrences.
- tasks.completed_at on a repeating task ("series done") has no calendar meaning: the calendar keeps showing every day unticked, the task leaves task lists, and the server's reminder pushes stop (notify HandleReminder skips completed tasks). MCP complete_task refuses it on purpose.
- Bug reported 2026-10-20 (user in UTC+9, "Throw away trash" daily 06:00): phone Today's schedule tick and web Today's right-click "Mark complete" wrote the series completed_at, so Today showed every day done while the calendar did not. Fixed in PR #241, merged into dev by the thread 2026-10-20 on the user's "Merge it": Today ticks the occurrence, both Todays read done like the calendar, occurrence edits refresh Today, recurring work blocks carry their day's done state, Today's Done counts days ticked today. Same branch draws phone Day view reminders as pills (they were 1px lines).
- Still writing series completed_at on repeating tasks: phone/web task detail Done and task-list ticks. Not changed; the user has not been asked.
- The user's own series stays marked done from the old tick until they tap Undo on it once (open it from the calendar).
- Preview quirk: Expo web never draws Home's StrikeTitle line (onTextLayout), before or after; real phones do.
Related: [android-testing-on-user-pc](android-testing-on-user-pc.md) [today-redesign](today-redesign.md)

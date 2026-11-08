---
name: today-redesign
description: Today page redesign PR #176 (option 1 day board) merged into dev 2026-10-15
metadata:
  type: project
  modified: 2026-10-13T15:37:01.764Z
---

On 2026-10-13 the user asked to "redesign the today page. so many wasted space". Four options were shown in an artifact (shots /mnt/project-files/today-redesign/options/). Option 1 was recommended and built on feature/today-redesign-hgh8cf as PR #176 into dev:
- Desktop board: Today focus and suggestions | vertical DayTimeline | rail (Habits and goals, Reminders, Overdue, End of day).
- Phone Home has the same order in compact panels.

The user said "merge it" on 2026-10-15 and #176 was merged into dev (option 1 kept). Any later change goes on a fresh branch and a new PR.

Critique and before/after shots are in /mnt/project-files/today-redesign/.

There's a hydration warning on the Today header date ("Your day" vs the date). It already happens on dev and is not fixed.

Related: [design-system](design-system.md)

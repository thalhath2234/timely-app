---
name: calendar-past-drop
description: PR #148 (2026-10-11) refuses calendar drops/moves onto past time and limits the post-drop re-plan to displaced tasks
metadata:
  type: project
  modified: 2026-10-11T11:19:21.223Z
---
Thread "calendar past-date drop" (2026-10-11): user saw a task dropped on a past day appear twice. Cause: two tasks with the same name ("Comprar leche") plus the calendar running a full Auto-schedule after every drop/move, placing every waiting task.

PR #148 (fix/calendar-past-date-drop-b7upx5) MERGED into dev 2026-10-11:
- API refuses AddBlock / MoveByHand starts in the past (5 min grace; same-start resize allowed). Responses carry displacedTaskIds.
- Web: toast on past drop; month drop on today = next quarter hour; re-plan only displaced tasks.
- Phone: alert on refused block move.
Follow-up PR #149 MERGED into dev 2026-10-11: calendar "Waiting for a slot" + Auto-schedule count (web and phone) now drop tasks with a Block still ahead (contract hasUpcomingBlock); placed Overdue blocks get a red dot / "· overdue". RankList itself unchanged (Today suggestions, agent rank tool). Merges cleanly with #148.
Screens: /mnt/project-files/calendar-past-drop/.

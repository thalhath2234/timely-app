---
name: jev-phase7
description: Jev Phase 7 (Today, scheduling, calendar; items 28-37, 40) built 2026-10-09 on feature/jev-phase4-j1vvw6; what it covers and live-test quirks
metadata:
  type: project
  modified: 2026-10-09T23:02:33.968Z
---
Phase 7 = plan items 28–37 and 40 (38/39 not in it; 39 "which occurrences" already existed in chat triage). Built 2026-10-09 after #126 merged, same branch. PR #127 merged 2026-10-10.
- Stored traits on tasks (migration 20261009223135): effort_kind, urgency 0-4, group_key, traits_hash. Filled for the top 12 ranked tasks before each Auto-schedule Preview (package-level schedule.SetBeforePreview hook, 4 s), on Today, and in task hints. Urgency adds (level-2)*6 to ScoreTask; groupClose keeps same-group tasks within 10 points adjacent.
- GET /suggestions/today: focus picks (Score level >= 2, any confidence, max 3), next free gap >= 20 min today with a fitting task (Flag threshold), goal counts. Settings > Agent: goals (<= 5) + best time for deep work (agent_provider_settings.decision_goals / deep_work_time).
- Task hints: oneSitting (>= 90 min, not contiguous), deep-time window (morning 06-12, afternoon 12-17, evening 17-22).
- Notifications: overdue/missed carry data.suggest + "Suggested: ..." body; POST /notifications/:id/triage runs reschedule/extend/lower/addtime/move (move/addtime replan that task with IncludeManual).
- Chat triage: "meeting" question (prepare/add/remind) as a hint line.
- Review fixes: triage move/addtime dry-run Preview first (Apply with IncludeManual deletes all manual blocks even if unplaced); triage step filled async after the notification (2 at a time); traits hook only on Preview (not Undo/Capacity), paused 2 min after timeout; deep window clipped to working hours.
- Live quirks: Score confidences run low (hence focus ignores confidence); gap pick varies run to run (0.53 vs 0.73 for the same state). Mobile has no goals settings.
- Screenshots: /mnt/project-files/jev-ideas/screens/phase7/. Live test used timezone America/Los_Angeles to get daytime free gaps.
Related: [jev-phase6](jev-phase6.md) [jev-phase5](jev-phase5.md)

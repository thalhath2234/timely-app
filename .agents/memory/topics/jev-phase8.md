---
name: jev-phase8
description: Jev Phase 8 (notifications and Dashboard; items 86-93) PR #129 merged 2026-10-10; smart alerts, briefing, Highlights card, live-test quirks
metadata:
  type: project
  modified: 2026-10-10T04:12:24.346Z
---
Phase 8 = plan items 86–93. PR #129 merged into dev 2026-10-10 (merge 80c7d9d) by the thread at the user's request.
- Smart alerts: daily job `smart_alerts` (migration 20261010040000 also adds notification category `suggestion`), from MorningDigestAt; setting NotificationSettings.smartAlerts (nil = on). Candidates in code (due ≤3 days with no future block, unblocked by a task finished ≤3 days ago, project due ≤7 days, ≥3 Inbox items waiting ≥3 days, stale work); Jev alert yes/no read at Flag (Prefill was too strict: due-tomorrow invoice scored 0.77), step at Flag, group at Route; same-project candidates joined in code. Max 3/day, dedupe suggestion:<user>:<day>:<key>; work alerted in last 7 days skipped (via notifications.data.taskIds, so "Clear all" resets it — known gap). Steps via POST /notifications/:id/triage: focus, reschedule (Preview first), review/clarify just mark read.
- Morning briefing: "Top today: …" prefix, picked by Jev (Flag), delivered after the call in a goroutine (10 s budget incl. slot wait).
- Highlights card (built-in `highlights`, not in default layout): POST /suggestions/highlights; client facts from contract highlightFacts + server blocked/unfinished facts; themes/reasons, Score per fact (level ≥2, top 3), tips (Prefill, top 2).
- Live-test seed in schema p4 (demo@timely.test): duplicate test tasks were deleted; Shop launch deadline set; inbox items backdated. Screenshots: /mnt/project-files/jev-ideas/screens/phase8/.
Related: [jev-phase7](jev-phase7.md) [jev-ideas](jev-ideas.md)

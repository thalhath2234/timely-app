---
name: phone-parity-habits-goals
description: Phone parity + issue #128 habits/goals work added to PR #131 on 2026-10-10 (phone views on server, chat client flag, focus package)
metadata:
  type: project
  modified: 2026-10-10T12:33:10.392Z
---
Added to PR #131 (commit 23e1e7c, 2026-10-10) after the user asked for phone/desktop parity and issue #128. PR body says "Closes #128". PR #131 merged into dev 2026-10-10; the user needs to pull dev and restart the API for the two new migrations.

- Phone saved views now live on the server: configs.mobile_task_views / mobile_active_task_view_id (migration 20261010120000). The device file is only an offline copy; nativeTaskViewsMerge.ts does the three-way rebase. Chat sends `client` ("phone" or web), stored on agent_conversations.client; view tools act on phone views only when client=phone (MCP = web). Chat can list/create/update/set-active views; delete stays MCP-only. Smart search takes client=phone.
- Habits and goals: package features/focus, tables habits, habit_checks, goals, goal_task_tags (migration 20261010121000 copied decision_goals; old column kept, unread). "Habits and goals" block at top of web /today and phone Home. Goal progress = Jev feature goal_progress, tasks carry project names. Agent tools in agent/tools_focus.go. Included in backups. Settings > Agent keeps only deep-work time.
- Phone template picker (components/files/NewFileTemplates.tsx), GET /suggestions/doc-template.
- The user said to ignore the three web-only screen tips.
- Not checked in the cloud: the phone new-row sheet cell check (needs the native formula bar).
- The unmerged branch feature/dashboard-cards keeps its own habit storage in card settings; if it is merged, its Habits card should read /habits.
- Gotcha: Expo started with CI=1 does not watch files; restart it after edits before screenshots.

Screens: /mnt/project-files/jev-ideas/screens/parity/. Gallery section "Phone parity" in https://claude.ai/artifact/PrLLvaSv4b7tFJxEP66HuF. See [jev-review](jev-review.md).

---
name: jev-phase9
description: Jev Phase 9 (onboarding and personalisation; items 94-98, the last phase): starter labels, screen tips, chat prompts, saved-view search pick, learned defaults; live-test quirks
metadata:
  type: project
  modified: 2026-10-10T04:53:41.648Z
---
Phase 9 = plan items 94–98, the last Jev phase (2026-10-10). Branch feature/jev-phase4-j1vvw6.
- Onboarding (web + phone) has step 1 "What will you use Timely for?" (8 uses); code-only presets (round-robin per use, max 10) are created with the first workspace. Use case is saved as words in `suggestion_prefs` (migration 20261010060000), editable in Settings → Agent.
- Starter labels card in Workspaces → Labels (Jev yes/no per catalog label, Flag). `lables.name` is globally UNIQUE (pre-existing quirk), so taken names are skipped.
- Screen tips (today/tasks/calendar/inbox): code catalog + Jev Choice asked twice, read at 0.3 (Flag was too strict live: best-tip confidence 0.3–0.6). Today's tip often comes out "none" (orders disagree).
- Chat example prompts per project; search offers a saved view ("Open view …", phone too since PR #131 moved phone views to the server). Since PR #162 a plain name match in code comes first (no key needed) and Jev's pick is read at Prefill.
- Learned defaults: last 20 answered decision_log rows per feature; kept <40% (≥8 answered) raises min by 0.15, <20% by 0.3. Settings → Agent lists them with Reset.
- Gotchas found: tasks.created_at/updated_at are TEXT (YYYY-MM-DD), so compare as strings; GORM Scan into a struct resets fields missing from the result.
- Live-test seed in schema p4: demo has a "Needs attention" view, 8 seeded stale_work rejections, plus users new@timely.test / new2@timely.test (demo password). Screenshots: /mnt/project-files/jev-ideas/screens/phase9/.
Related: [jev-phase8](jev-phase8.md) [jev-ideas](jev-ideas.md)

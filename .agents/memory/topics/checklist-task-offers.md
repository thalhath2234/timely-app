---
name: checklist-task-offers
description: Doc checklist rows offered as tasks ("Make task"): Jev picks them, X kept per doc, per-doc switch, suggestions need a key (#255, merged into dev 2026-10-31)
metadata:
  type: project
---

2026-10-31, thread "Fix Help me write checklist context": user asked "why do i have options to make it a task" (every multi-word unticked row got Make task, even with suggestions off; X forgotten on reload). Picked option 3 "both" plus: only while smart suggestions are on, suggestions need an OpenRouter or TypeSafe key to switch on, and Jev decides whether a row looks like a task.

User said "open pr and merge it" (2026-10-31): PR #255 (fix/checklist-task-offers -> dev) MERGED 2026-10-31 07:36 (merge 497ed11) after a review pass fixed 7 bugs (commit 75fd54b): asks up to 50 not-yet-handled items of up to 200 sent; "todos" skips the 200 dismissal cap, past it 409; offers-off race fixed (reads cancelled, useDocOffersOff shows pending change, rollback + toast, one change per doc via mutation scope); undo/failed change frees the logId; checklist read waits for decisions status.
- API DocChecklist asks Jev per open item (feature "doc_checklist", state has the doc's checklists with headings); only a confident yes (decide.Route) goes in `offer`. readsLikeTask and keptLists removed.
- Dismissals: "todo:<name>" per row, "todos" for the whole doc; DELETE /suggestions/doc/:id/dismiss restores. DocHints.todosOff.
- Turn back on: web Outline card switch row (wide), "Task offers off · Turn on" chip under the title (narrow), phone doc More sheet switch. Card X / phone text link "Don't offer tasks in this doc" turns off with Undo.
- PATCH /agent/decisions enabled:true answers 409 without a usable key; web and phone switches disabled, badge "Needs a key".
- Proof boards (stand-in Jev = rows starting with an action word): /mnt/project-files/checklist-task-offers/. Not checked on a real phone or with real Jev.
- Open design question offered: desktop card uses an X (tooltip) for "offers off"; could be a labelled button.
Related: [help-me-write](help-me-write.md), [jev-review](jev-review.md).

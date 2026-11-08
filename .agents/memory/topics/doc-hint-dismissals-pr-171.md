---
name: doc-hint-dismissals-pr-171
description: PR #171 (2026-10-13) fixed doc "reads like a task" suggestions duplicating tasks; dismissals now stored server-side in doc_hint_dismissals
metadata:
  type: project
  modified: 2026-10-13T14:35:50.178Z
---
User saw the phone doc card re-offer "reads like a task" lines on every open, including lines already made into tasks and a half-typed line ("Setup live notifications mobile for"), creating duplicate tasks (user's own duplicates left for them to delete).

Cause: doc hints are refetched only when word count crosses a multiple of 50 and stay cached; X dismissals were in-memory only.

PR #171 (branch fix/doc-suggestions-duplicate-tasks-p45g8e, into dev; merged into dev 2026-10-15 after a dev merge; migration renamed to 20261015160000 so goose applies it after 20261014090000): clients show a work line only if it is still a plain paragraph in the live doc (`docWorkLines` in @timely/contract/docChecklist); Create task invalidates hints; API skips lines whose task was done since the doc was created; new table `doc_hint_dismissals` + `POST /suggestions/doc/:id/dismiss {kind, value}` (needs API restart for the migration). Checklist-item X stays local.

Inference, unconfirmed: the user's phone showed no checklist section, so the API it talks to may be older than the phone APK.
Shots: /mnt/project-files/doc-suggestions-duplicates/. Related: [jev-phase6](jev-phase6.md)

Follow-up PR #223 (2026-10-18, branch fix/doc-task-hint-after-edit-52ae01, merged into dev 2026-10-18 as 32e0216 on user's "merge it"): edited lines were re-offered because matching was exact text. Now API `sameWork` (suggest/line_match.go) matches by meaningful words (75% for unlinked same-workspace tasks, 60% for tasks linking the doc / dismissed lines); Create task on a work line uses contract `workLineTask` (description "From <doc>: “line”") and also POSTs dismiss kind work. Checked on user's PC with a Jev stub (fresh users get available:false; .env OpenRouter key is not a fallback).

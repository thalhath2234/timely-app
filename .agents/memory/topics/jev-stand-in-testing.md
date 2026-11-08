---
name: jev-stand-in-testing
description: How to test smart-suggestion (Jev/decide) features in the cloud with a local stand-in, and the gotchas that hide answers (cache, learned raise)
metadata:
  type: reference
  modified: 2026-10-31T07:33:59.216Z
---

Learned on the checklist task offers PR #255 (2026-10-31). Use when a feature asks Jev through `decide.Ask` and there is no real TypeSafe key.

- Stand-in: a tiny node HTTP server on 127.0.0.1 answering `{model, answers:{<id>: {type:"noul", noul:0.94}}}`. Build the API with `typeSafeURL` in apps/api/internal/features/decide/client.go sed'ed to it, then `git checkout` the file right away (never commit it). Save a TypeSafe key ("ts-standin-key-123") and PATCH /agent/decisions {enabled:true} for the test account.
- CACHE: decide caches answers for 10 minutes by (user, feature, state). Re-running a check with the same doc and text never reaches the stand-in, so an added delay or a changed answer does nothing. Put something unique in the state each run (e.g. a typed item with the process id).
- LEARNED RAISE: feedback counts. After a few "rejected" answers (e.g. turning offers off in repeated runs) decide/learned.go raises the feature's minimum confidence by up to +0.3, so stand-in answers of 0.94 stop showing and the UI looks broken. Check GET /agent/decisions/learned and reset with POST /agent/decisions/learned/reset {feature}.
- To race a click against a read, delay only that feature's requests in the stand-in. The server reads doc settings before calling Jev, so click a moment after the request starts, not at once.
- Test tokens last 30 minutes; log in again (scratch seed script) before API calls.

Related: [cloud-env-testing](cloud-env-testing.md), [checklist-task-offers](checklist-task-offers.md), [jev-review](jev-review.md).

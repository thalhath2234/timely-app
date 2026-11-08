---
name: grouped-agent-review
description: Agent change review grouped per kind (option 2 accordion + numbers strip), per-card Apply/Discard; PR #260 MERGED into dev 2026-10-31 10:00
metadata:
  type: project
  modified: 2026-10-31T09:05:32.706Z
---

Thread "Group agent changes for review" (2026-10-31). User reported 30 sheet rows from the agent showing as 30 separate review cards, raw field dumps, and docs showing "[ ]" bullets.

Decisions by the user:
- Layout OPTION 2 (user wrote "no option 2" right after tapping option 1 on the card): summary numbers strip on top, one card open at a time (accordion).
- "apply and discard individually or all": each card has Apply this / Discard (then "Won't be applied" + Bring back); footer Apply all / Discard all. A receipt stays all-or-nothing.
- Fixed design per kind: sheet = table per tab in sheet column order with "Each with ..." shared values; tasks = one list; doc = rendered preview with real tick boxes; events list; anything else = field rows.

What was built (branch `feature/grouped-agent-review`, commit 9f43167 pushed 2026-10-31, NO PR until the user says):
- Server merges consecutive add_sheet_row steps into `add_sheet_entries` (chat/merge.go); new tool add_sheet_entries.
- Partial approval: POST /chats/:id/approve takes `steps`; POST /chats/:id/steps/discard `{revision, steps, keep}`; step status `approved`; dependencies pulled in / dependents discarded (chat/selection.go).
- Shared view model packages/contract/src/changeReview.ts (`make test-change-review`), used by web changeCards.tsx and phone ChangeCards.tsx.
- Markdown rule (Go + TS parity): a list with any tick box is a whole checklist (same rule as [help-me-write](help-me-write.md)).
- Web chat header showed two collapse buttons: fixed (historyOpen wired).
- Discard all (/reject) after a partial apply keeps applied steps (plan stays, rest discarded, "Done" notice); phone stays on the review after "Apply this".
- Seen while testing (existing behaviour, not changed): two chats proposing into the same sheet tab; applying one makes the other's apply stop with "The data changed... Preparing a refreshed proposal" (snapshot check). Possible follow-up: let appends to a tab skip that check.

Testing: no Anthropic key in the session env, so the stand-in model was used, not Haiku ([model-key-for-tests](model-key-for-tests.md)). Pre-existing failures not from this branch: `make test-genui` board-check.js out of date (run make gen-board-check on dev); audit-chat receipt "Expense sheet" toHaveValue on the custom Select.

Proof shots: /mnt/project-files/agent-review-cards/ (before-app/, after/, options/, compare/ = labelled before/after strips sent to the user 2026-10-31). User answered "merge it" 09:33: dev merged into the branch (a57b209), PR #260 opened 09:57, CI green, MERGED into dev 10:00 (62ff9b2). Follow-ups go on a fresh branch.

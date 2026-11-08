---
name: natural-language-views
description: Natural-language task views (PR #182, 2026-10-14) - shared rules engine, no-key reader, search listing card, AI view reading
metadata:
  type: project
  modified: 2026-10-14T04:52:30.962Z
---

Thread "natural language views" (user asked: natural language instead of key matching, create views from words, filters for any listing). PR #182 merged into dev 2026-10-15 (user said merge), branch feature/natural-language-views-m78enz.

- Shared engine `packages/contract/src/taskQuery.ts` (rules, sort with empty-last, then-sort, limit, date-bucket groups) and no-key reader `viewLanguage.ts` (`readViewQuery`, `describeView` chips, `viewFromAiDraft`, `vocabularyFrom`). Web and phone Tasks both run through it; `make test-view-language`.
- View fields added: rules (one level of any/all groups), ruleMatch, thenSortBy/Direction, limit, prompt. Go `ViewRule` keeps values as RawMessage.
- Search (web Ctrl+K and phone Search) shows a listing card; Open = unsaved Preview tab, Save as view. "new view called X: ..." saves directly. Jev's looser view pick goes below the card; a saved view named outright stays first.
- AI: `POST /agent/view-query` uses the generative provider (same as Help me write). Shown as "Read with AI" / "Make a task view from these words" only on request.
- Phone previews/saves go through `lib/viewPreviewStore.ts` (Search can't own a second `useNativeTaskViews`).
- 2026-10-15 (user said yes): rule builder added to #182 (commit 56601de). Web rules row: describe box (words replace filters; sort/groups/layout/limit only when named, `readingPatch`), Add filter, chips open editor, Match all/any; Sort button panel has Then by + Show first N. Phone View sheet: Filters block, RuleEditorSheet, Then by, Show 5/10/20. Shared `@timely/contract/ruleBuilder`. Built option 1 of 3 (critique rule-builder-critique.md). Left: project-list rules, editing any-of groups part by part.
- Expo web dev: a new contract export needs Metro restarted with /tmp/metro-file-map-* deleted; `pkill -f "expo start"` kills your own shell, kill by pid.
- Plan, critique, shots: /mnt/project-files/natural-language-views/. [design-system](design-system.md)

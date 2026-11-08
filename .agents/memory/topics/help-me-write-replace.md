---
name: help-me-write-replace
description: Help me write decides replace / insert / end from the prompt (2026-11-02, PR #274 merged)
metadata:
  type: project
---

2026-11-02 thread "Stop Help me write duplicating lists": user asked "convert the bullet points to checklists" with nothing selected and got a duplicate list, because the panel only had Insert at the caret. User wants Help me write to recognise from the prompt and content what to do.

Built on `fix/help-me-write-replace` (fd10003). PR #274 MERGED into dev 2026-11-02 21:31 on the user's "merge it after" (CI green; adds 9db9600 repeated-lead fix). API restart, no migration. Follow-ups: fresh branch.
- Protocol: client sends `place: true` for typed prompts; API write.go shows the doc as `<block n>` tags (numberedBlocks, window around the cursor, long blocks cut and not replaceable); model starts with `<place>replace N-M|cursor|end</place>` (selection: replace|below); takePlace validates and returns `place {mode, from, to}` (0-based, sent doc). Contract liveBlockIndex maps past the cursor line cursorDoc added.
- Clients find the blocks again by content (findBlocks web writeRange.ts / writeFindBlocks phone), so edited text is never replaced; placeBlocks joins same-type lists; Undo toast "Replaced 15 bullet points".
- UI (design-critique, grouped row): "Replaces | 15 bullet points" row above the preview, target lines tinted; footer Replace (primary) + Insert below; "At cursor / Add at end" only when caret is not at the end; phone "Below"/"Replace".
- Tested with Haiku only (recorder harness, see [ai-live-test-harness](ai-live-test-harness.md)), web 4002 + Expo web phone harness [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md). Proof: /mnt/project-files/help-me-write-replace/ (boards desktop/phone light/dark, before/, after/, adds/). Real phone not checked.
- Background: [help-me-write](help-me-write.md).

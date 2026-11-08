---
name: doc-todo-turn-into
description: Doc to-do box alignment + Turn into for every text block (thread "Fix doc checkbox alignment and Turn into", 2026-11-02), PR #275 merged into dev 2026-11-02
metadata:
  type: project
  modified: 2026-11-02T14:53:27.741Z
---

User reported 2026-11-02 (desktop screenshots): to-do boxes sat low next to their text; block menu had Turn into for Heading 1 but not for To-do.

Causes: web globals.css gave the task label `margin-top: 0.35rem` on top of its own 28px line box (box ~4px below the line's middle). Phone was already centred (0.4px off). Turn into was gated to paragraph/heading only (`textual`) in web blockMenu.ts and phone blockInfo.

Fix on `fix/doc-todo-align-turn-into` (commit pushed 2026-11-02, NO PR until the user says):
- Web: label is `display:flex; height:1lh`, checkbox `appearance:none` drawn like TaskCheck (tick = label::after mask in --primary-foreground). Rows now 28px, same rhythm as bullet lists.
- Turn into: apps/web/app/_components/editor/turnInto.ts and phone apps/mobile/lib/blockTurn.ts (BLOCK_TURN_JS, plain JS pasted into editorHtml), same steps, `make test-block-turn` (scripts/block-turn.test.mjs, 25 cases on both). Items leave their list (split), same-kind neighbour lists join, nested blocks/ticks kept, code <-> lines, callout/quote/toggle unwrap. Not offered for tables, images, live blocks (openui-lang). Toggle only for one block.
- Phone: Block sheet acts on the block it was opened for (pickedBlock via blockPickKey), not the caret at pick time; blockAction too.

Proof: /mnt/project-files/doc-todo-turn-into/compare/ (1-7, light+dark), raw shots in the folder, critique.md. Phone via Expo web harness ([phone-doc-editor-web-harness](phone-doc-editor-web-harness.md)), not a real phone.
- 2026-11-02 follow-up (user: highlighted block on phone had no padding, not centred): .block-picked is now a ::after tint inset -6px -10px, radius 10, and stops above a to-do row's inner 0.75em gap; layout unchanged (commit 5e95e40). Proof /mnt/project-files/doc-todo-turn-into/highlight/.

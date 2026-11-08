---
name: doc-page-layout
description: Doc page layout rework (PR #199, 2026-10-15): tab-strip actions slot, one-row toolbar, suggestions rail, phone summary row, checklist grip fix
metadata:
  type: project
  modified: 2026-10-15T07:01:08.025Z
---

Thread "Doc page layout" (2026-10-15), PR #199 into dev, option 1 of 3 in /mnt/project-files/doc-page-layout/critique.md (2 = vertical toolbar rail on the left, 3 = margin cards next to lines). User picked a 2+3 mix (mockup https://claude.ai/artifact/62Mdb4YmviMZmosGwmkPhf), built into #199 on 2026-10-15: pages >=1024px get toolbar rail (RichTextEditor toolbarLayout="rail", insert tools in one Insert menu) + MarginHints in docHints.tsx (cards level with rows, open card floats over others, line marked by a PM decoration); phone rows get markers + card under the row drawn in editorHtml.ts (LineHints, matched by row text from components/docs/lineHints.ts). Regexes in editorHtml.ts need \\\\s in the TS source (template literal).

- Web: no breadcrumb row. Pages portal save status + actions into the tab strip's right end via `TabStripActions` (pageTabs/stripActions.tsx); files-list toggle is at the strip's left (ExpandCollapsedListButton deleted). `RichTextEditor` `toolbarHost` renders the toolbar into the page's row and lets the page scroll (`.doc-page-scroll`/`.doc-page-grid` in globals.css; rail at container width >= 74rem). DocHints shows 4 checklist rows + "Show N more", icon-only Make task in the rail (`@container`; Tailwind 4 syntax is `@max-lg:`, not `max-@lg:`).
- Phone: DocHintsCard is one summary row opening a sheet; DocScreen hides title/related/hints while the editor is focused and the keyboard is up.
- Grip bug cause: posAtCoords over a task checkbox resolves to the whole list; blockHandle.ts now reads the `li` under the pointer.
- Checklist suggestions (user, 2026-10-15: "a grocery list with checkbox shouldn't be a task"): doc hints ask Jev one yes/no per checklist (heading + items); confident "kept in the doc" lists come back as `keptLists`, and `openChecklistItems(content, keptLists)` drops the whole list. Without Jev every unchecked item is still offered.
- Sheet page header untouched (only its files toggle moved). Another thread ("Doc images, saving and history") edits the same editor.
Related: [doc-sheet-tabs](doc-sheet-tabs.md), [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md), [feedback-design-skills](feedback-design-skills.md).

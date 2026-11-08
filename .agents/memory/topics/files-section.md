---
name: files-section
description: Docs and Sheets merged into one "Files" section with /files/<id> routes (PR #110, 2026-10-08)
metadata:
  type: project
  modified: 2026-10-08T14:17:22.164Z
---

2026-10-08 thread "combine the doc and sheet into a single tab": user asked to merge Docs and Sheets into one section and fix every /docs and /sheets link. PR #110 against dev (web/desktop/mobile), MERGED into dev 2026-10-08.

- Name "Files" (mobile tab was already called Files). Routes: web `/files`, `/files/<id>`; mobile `/(app)/files/<id>`, tab `(tabs)/files`. The ID prefix picks the editor: doc_ doc, sht_ sheet, shtpl_ sheet template.
- Helpers: apps/web/app/utils/fileRoutes.ts and apps/mobile/lib/fileRoutes.ts (fileHref, fileKind, legacyFilePath). Use them, not string paths.
- Old /docs*, /sheets* web paths redirect in apps/web/proxy.ts; saved page tabs (timely.pageTabs) migrate on load. Mobile keeps redirect screens at docs/[id], sheets/[id], sheets/templates/[id].
- Shortcut G then F (G D / G S still go to Files). Doc and sheet stay separate types; the API was unchanged (links are stored as timely://doc|sheet/<id>).
- Why: user's real goal was that switching between a doc tab and a sheet tab felt like a page reload (old /docs and /sheets layouts remounted, plus PageFade keyed to the section). PR #110 also makes TabbedPane render the active tab's FileView itself (keyed by id) so switches skip the route round trip (~90 ms prod). Undo history still resets on a switch (TipTap editor is recreated); keeping tabs alive would need the editor to survive, since recreating it from seed content would lose edits.
- Not tried on a mobile device or a packaged desktop build.

Related: [doc-sheet-tabs](doc-sheet-tabs.md), *docs-notion-obsidian-features*.

---
name: jev-phase6
description: Jev Phase 6 (docs, items 48-57) built 2026-10-09 on feature/jev-phase4-j1vvw6; what it covers and live-test quirks
metadata:
  type: project
  modified: 2026-10-09T22:14:27.774Z
---
Phase 6 = items 48–52, 54–57 (53 was Phase 3). Built 2026-10-09 on feature/jev-phase4-j1vvw6 after #125 merged; PR #126 merged into dev 2026-10-09 (bc1df1d).
- API: suggest/docs.go — GET /suggestions/doc/:id (project, parent page, type, property values from keys on 2+ docs, template for a near-empty doc, work lines, outdated only after 30 idle days), POST /suggestions/mention, POST /suggestions/import-format. chat/doc_jev.go adds draft/contradiction review questions for create_doc/update_doc/append_to_doc.
- Web: docs/docHints.tsx card under the doc meta row; editor/mentionLink.tsx toolbar button ("Link selection to an item"); "Move to page" submenu in useDocContextMenu; importMarkdown.ts formats plain-text imports (3–80 lines, no Markdown).
- Mobile: DocHintsCard (project, parent, work lines, outdated only).
- Live Jev quirks: parent and property picks vary run to run (Route/Prefill); "the shop" got no confident mention match; import kept list-like lines as paragraphs.
- Outdated screenshot needed a throwaway build shifting DocHints' now by 100 days (never committed).
- Screenshots: /mnt/project-files/jev-ideas/screens/phase6/.
Related: [jev-phase5](jev-phase5.md) [jev-phase4](jev-phase4.md)

---
name: doc-sheet-tabs
description: Obsidian-style tabs for docs and sheets (web/desktop) built in PR #100, 2026-10-08; scope and behaviour decisions
metadata:
  type: project
  modified: 2026-10-08T11:24:26.536Z
---

2026-10-08 thread "Tabs like Obsidian": user asked if Obsidian tabs were a good idea, then asked for tabs for docs and sheets only (explicitly NOT tasks/projects). Mobile left unchanged by recommendation.

PR #100 merged into dev 2026-10-08 11:26 UTC. Key behaviour:
- One shared strip for docs and sheets (TabbedPane in the docs/sheets layouts), per-tab back/forward and scroll restore, drag to reorder, saved per device in localStorage (`timely.pageTabs`).
- Ctrl/Cmd-click or middle-click any doc/sheet link opens a background tab (window capture listener, no editor changes); "Open in new tab" in doc/sheet context menus.
- Desktop shortcuts via Electron before-input-event, only while the strip shows: Ctrl/Cmd+T/W, Ctrl+Tab, Alt+arrows (Cmd+[ ] on mac).
- Switching tabs remounts the page: undo history does not survive a switch.
Not tried on a packaged Windows build. Related: *docs-notion-obsidian-features* (PR #98, no conflicts with #100).

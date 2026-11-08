---
name: mention-tap-pr-179
description: PR #179 (2026-10-14) phone mention chips open their doc/sheet/task/project on tap; long press selects the chip to edit
metadata:
  type: project
  modified: 2026-10-14T04:02:13.473Z
---
User tapped "From @Doc" (added by doc "reads like a task" -> Create task) in a phone task description; it only focused the editor. The phone WebView editor (editorHtml.ts) had no mention tap handling anywhere (descriptions and docs).

PR #179 (branch fix/phone-description-mention-tap-fmhqaz) MERGED into dev 2026-10-15 (after dev merged in; CI green): `openMentions` option (default on) takes the mousedown on `.mention` via handleDOMEvents, so no focus/keyboard; the click sends `openMention` and RichTextEditor routes it with `hrefFor`. Long press (contextmenu) = NodeSelection with a ring, then Backspace/typing edits. QuickAddSheet passes openMentions={false} (modal would hide the opened screen). Web already worked (richTextEditor.tsx click handler), confirmed live 2026-10-14.

Needs a real-phone check: tap opens, long press selects (Android WebView native selection could win). Shots /mnt/project-files/mention-tap/. Side finding: web /files/<id> at 390px width keeps the Files list sidebar and pushes the editor off-screen (not fixed).
Related: [doc-hint-dismissals-pr-171](doc-hint-dismissals-pr-171.md), [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md)

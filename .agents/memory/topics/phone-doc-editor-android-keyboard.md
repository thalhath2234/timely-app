---
name: phone-doc-editor-android-keyboard
description: Why Android keyboard edits failed in the phone doc editor (checklist label text, deletes read as Enter), the fix branch, proof images and the phone-Chrome diagnostic kit
metadata:
  type: project
  modified: 2026-10-23T13:24:45.735Z
---

Thread "Select all + backspace in phone docs" (branch fix/mobile-doc-select-all-delete-dazho3, commits afe6f22 + ccf2751, merged into dev as #247 on 2026-10-23; not checked on a real phone):
- Android keyboards (Gboard) edit the WebView through plain-text offsets (setSelection + deleteSurroundingText / commitText). Chrome refuses an edit whose range starts inside a contenteditable=false element. Tiptap's TaskItem label held a native checkbox (counts as 1 char) plus a visually hidden "Task item checkbox for <row text>" span, so offset 0 of a doc that starts with a checklist mapped into the locked label. Before the fix, Select all + backspace deleted one character (the end of the first row) and nothing else.
- Fix 1 (afe6f22): DocTaskItem in apps/mobile/components/editor/editorHtml.ts draws the box with CSS on the label, hides the input and span (display:none), mirrors role/aria-checked on the label. Taps still toggle via the hidden input.
- Fix 2 (ccf2751): KeyboardDelete extension. On Android, ProseMirror reads a WebView delete that joins blocks as Enter (synthetic untrusted keyCode 13) and splits the line. The plugin records the beforeinput target range when it spans blocks and makes that delete itself in handleKeyDown (priority 1000, ahead of Enter keymaps); a delete that empties the doc is reset to one empty paragraph.
- Proof (keyboard path replayed with CDP Input.imeSetComposition replacement ranges in headless Chromium, Android UA, not a real phone): /mnt/project-files/doc-select-all/proof-select-all-backspace-{dark,light}.png.
- Desktop/web not affected (Ctrl+A and Backspace go through PM keymaps). Web editor still has the hidden span; only matters for the web app in a phone browser.
- Desktop Chromium's own Select all collapses to the doc end when the doc starts with a checklist; Android's toolbar Select all did select (user's screenshot).
- Real-phone kit (phone Chrome over adb + devtools forward): /mnt/project-files/doc-select-all/diag/ (README, instrumented pages before/-fixed with both fixes, diag.mjs).
Related: [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md), [android-testing-on-user-pc](android-testing-on-user-pc.md).

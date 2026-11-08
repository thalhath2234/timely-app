---
name: doc-images-saving-pr-200
description: PR #200 (merged into dev 2026-10-15): doc refresh-on-save fix, image cap/viewer/copy/paste, zip md export, session-based version history, template delete, AI Make task titles
metadata:
  type: project
  modified: 2026-10-15T07:13:39.744Z
---
PR #200, opened 2026-10-15 from branch fix/doc-images-saving-history-t9fkh3. Thread "Doc images, saving, history".

- **Refresh on save.** Remote doc copies now apply as a ProseMirror minimal diff, in `apps/web/app/_components/editor/applyRemote.ts` and in the phone's `editorHtml` `__timely.set`. Never go back to setContent: it reloads images and drops the caret.
  - The phone `DocScreen` applies a cache change only after a real remote event (`remotePendingRef`).
- **Version history** (`doc/versions.go`):
  - one rolling version per editing session (10 min quiet, 1 h max);
  - separate `assistant_change` and `restored` versions;
  - the newest version is marked `current`.
  - No migration, but the API needs a restart.
- **Markdown export.** `?format=markdown&images=zip` gives a zip with the .md and an images/ folder. It only packs the account's own files.
- **Make task.** It calls `POST /agent/checklist-tasks` (default provider and model) only when a provider is ready, and falls back to the item text.
- **Pending.** Real-phone checks are listed in the PR: Gboard paste, Copy image, two-device refresh, the 440px cap. Expo web can't run expo-file-system.
- Critique and screens: /mnt/project-files/doc-images-saving/. Related: [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md), [help-me-write](help-me-write.md).

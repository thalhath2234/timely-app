---
name: desktop-pointer-snap
description: Desktop confirm dialogs move the mouse pointer to Cancel via koffi FFI (Windows + Linux X11 only); PR #108 merged
metadata:
  type: project
  modified: 2026-10-08T14:09:45.931Z
---

2026-10-08, thread "Pointer to confirm dialog": the user asked that the mouse pointer jump to delete confirm dialogs. PR #108 (merged into dev 2026-10-08): shared ConfirmDialog snaps the pointer to Cancel in the desktop app only (electron/pointer.ts, IPC `pointer:snap`). Uses the koffi npm package (prebuilt FFI, install script disabled in pnpm-workspace.yaml allowBuilds) for SetCursorPos (Windows) and XWarpPointer (X11). Wayland can't do it; macOS is skipped because the user said to ignore Mac builds (same day). window.confirm() calls (bulk task delete, project/stage delete, backups, API keys) are native dialogs and are not covered.

**Why:** Electron has no pointer-move API; koffi ships only when electron-builder runs through pnpm (`pnpm exec`, as pack.mjs does). Under npm detection it drops the @koromix/koffi-* platform package.
**How to apply:** if pointer snapping breaks in a packaged build, check that app.asar.unpacked has node_modules/@koromix/koffi-<os>-<arch>.

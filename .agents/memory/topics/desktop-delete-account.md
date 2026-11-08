---
name: desktop-delete-account
description: Delete account in Settings > Account, desktop only (PR #142, 2026-10-11): DELETE /me with password, resets setupDone
metadata:
  type: project
  modified: 2026-10-11T06:02:28.045Z
---

PR #142 (merged into dev 2026-10-11, thread "delete an account ... only on the desktop app"):
- `DELETE /me` with body `{password}`. It returns 403 on a wrong password, is rate limited per IP, and answers `{registrationOpen, lastAccount}`.
- Rows that don't cascade from users are deleted explicitly in auth/repository.go `accountCleanup`: stages, jobs, notifications, push_devices, and schedules only this account used.
- After the delete it also removes the backup folder and invalidates the search index.
- The UI is gated on `window.timelyDesktop.instance`, like the Server tab, so it is packaged builds only (not `make dev-desktop`).
- After a delete the app resets `setupDone` when no account is left and does a full page load to /signup or /login.
- Kept on purpose: the whole-DB folder copies (`backups/manual-*`, `pre-upgrade-*`). Chat images are left to the 24 h sweep.
- Not yet tried in a real desktop build.

**Why:** a new table with a plain user_id column (no FK) must be added to `accountCleanup`, or the delete leaves orphans.
**How to apply:** run `TIMELY_TEST_POSTGRES=1 go test ./internal/features/auth -run DeleteUserPostgres` after schema changes. Related: [desktop-local-builds](desktop-local-builds.md).

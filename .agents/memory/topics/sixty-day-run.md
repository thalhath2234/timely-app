---
name: sixty-day-run
description: 2026-10-14 thread "60 day workflow" simulated 60 days of Timely use; PRs #184-#196 into dev, open follow-ups
metadata:
  type: project
  modified: 2026-10-14T11:02:35.630Z
---
On 2026-10-14 the thread for the user's "Emulate a 60 day workflow using all the features" simulated 60 days (Aug 17-Oct 15 2026) for a Tokyo persona. It covered the web, phone (Expo web at 390px), MCP and API, on a fake clock (patched Go time plus libfaketime Postgres).

PRs into dev, all assigned to the user and green:
- #184: phone calendar done state.
- #185: overdue alert after completing the task.
- #186: onboarding labels.
- #187: duplicate labels.
- #188: chat with no key.
- #189: reminders and digests missed while the computer slept.
- #190: web task panel data loss and project delete copy.
- #191: auto-schedule keeps repeating work at its set time.
- #192: bulk edit Undo per task and additive Set label (`@timely/contract/bulkEdit`).
- #193: phone repeating event, edit or delete one date.
- #194: activity times in the user's zone, workspace item `position` migration, job queue claims with the Go clock.
- #195: phone polish.
- #196: web polish.

Most of these PRs add a test target to the Makefile `test` line, so later merges need a dev merge.

Report, bug log and real-phone checklist: /mnt/project-files/sixty-day-workflow/report.md and bugs.md.

Open follow-ups:
- Completing a repeating focus task from Today completes the whole series.
- No per-occurrence event title or notes (needs an API change).
- No "snoozed until" UI.
- Web Today Join-call regex.

Android emulator pass, 2026-10-14, run on the user's PC by Remote Control, Expo Go, branch fix/sixty-day-workflow-fp5pft (test-only merge of #184-#196, never a PR):
- Most checks passed.
- System Back fix pushed to #195 as a68aea3.
- Keyboard lift is about one nav-bar height short on the New label form and Inbox. #181's useKeyboardCover fixes the Inbox; the label form still needs it.
- Release APK builds run the user's PC out of memory, at about 600 MB free with the emulator stopped. Don't build there while the desktop VM and other apps are running.
- Results are in report.md.

Electron pass on the user's PC (2026-10-14): all checks passed; #197 fixes the false orphan-scan timeout log. Desktop tests ran in a throwaway --user-data-dir, because the user's Timely Dev account password is unknown and sign-ups are off.

#198 (2026-10-15) has been turned into the all-in-one PR: fix/sixty-day-workflow-fp5pft is dev plus #184-#197, with conflicts resolved. It was opened from the Claude Code UI.
- Merging #198 lands every fix at once.
- Merge either #198 or the individual PRs, not both.
- Keep #198 in sync when a PR branch gets new commits.

MERGED 2026-10-15: #198 was merged into dev by the thread at the user's "you merge it" (dev merged in first, with conflicts resolved in Today/Home/schedule), so #184-#197 all show as merged. Follow-ups now go on fresh branches.

**Why:** a later thread may be asked to merge these PRs or continue the follow-ups.
**How to apply:** check `list_project_prs` for live state; the report has the merge-order notes. Related: [release-flow](release-flow.md).
- 2026-10-14 Electron desktop pass on the user's PC (Timely Dev build from the test branch, free memory stayed above 3.4 GB): all checks passed (launch + DB upgrade from 0.2.0, sign-in/onboarding/10 pages, Ctrl+W to tray with server/MCP up, tray Quit leaves nothing running, kill -9 cleanup, Server QR, Integrations MCP address, only Ctrl+W/K/Shift+J shortcuts). #197 opened: "orphans: scan timed out" logged on every launch, now only on a real timeout. Not run: Delete account, Sign out everywhere, Tailscale. User can delete ~/Dev/timely-dev-config-backup-2026-10-15 (108 MB).

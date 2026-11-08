---
name: open-threads
description: Full detail of the project's open threads as of 2026-10-21 (moved out of MEMORY.md to keep the index small)
metadata:
  type: project
  modified: 2026-10-23T13:24:44.342Z
---

Detail behind the one-line "Open threads" entries in MEMORY.md, as of 2026-10-21. Update or delete lines here when a thread closes.

- "Release v0.3.4": waiting on the user to push the v0.3.4 tag and say the build finished; then AUR checksum PRs.
- Merged 2026-10-20, threads open until the user acknowledges; real-phone checks pending (user rebuilds with make install-apk): "Edit custom widgets" (#242; widget "Edit this card" link untested on phone), "Predictive back threshold" (#239; Android's own arrow/buzz still 16dp, offered our own buzz at 32dp), "Recurring reminder done state in calendar" (#241; Task details' Done still finishes the whole series; user must Undo "Throw away trash" once), "Board card size on phone" (#240; optional offer: move "30m" next to badges for ~45dp more title room).
- "Phone motion loops": #243 merged into dev 2026-10-20 by the thread on the user's "Merge it" (2x lossless loops, +1.2 MB APK). Offered follow-ups, no answer: schedule loop clipped labels, cards loop crowding, Reduce motion blank frame. [phone-motion-loops](phone-motion-loops.md)
- "Select all and delete in phone docs": #247 merged into dev 2026-10-23 by the thread on the user's "merge it" (CI green). Not checked on a real phone yet; diag kit /mnt/project-files/doc-select-all/diag/. [phone-doc-editor-android-keyboard](phone-doc-editor-android-keyboard.md)
- "Phone calendar ticks and lag" (2026-10-20, Poteto-mode): circle now ticks (one day for repeating), Agenda virtualised (3 s -> 0.24 s), month/week paging without re-centring, Day view scroll jump fixed. Branch fix/phone-calendar-ticks-and-lag-s6ynvd pushed, no PR. Report /mnt/project-files/phone-calendar/report.md. Waiting on user: open PR or phone test first? Swipes untested. Thread offered to run /interrogate on the branch (strict poteto). [phone-calendar-fixes](phone-calendar-fixes.md)
- "Phone chat composer flicker" (2026-10-21, Poteto-mode): cause = settings taps in a saved chat locked and dimmed the whole composer for the save. Fixed (instant toggle, per-chat TanStack scope, API keeps revision on settings). Branch fix/mobile-chat-composer-flicker-7bo3bo pushed, no PR. Waiting on user: open PR? phone test? Offered app-wide press-dim easing. [composer-flicker](composer-flicker.md)
- "Ways to ship Timely on Arch" (2026-10-20): thread listed 6 options; user picked "setup pacman" = electron-builder `pacman` target on every release (Timely-X.Y.Z-linux-x64.pacman, self-update tested 0.3.4 -> test 0.3.5 on Arch in cloud). Branch feature/pacman-package. Waiting on user: open PR? Other options offered: Chaotic-AUR, own signed pacman repo, source AUR pkg, Flathub (poor fit: host CLIs/Tailscale), Snap/[extra] (not worth it).
- "Premium look report for the app" (resolved): week-in-review video #234 merged [week-in-review-video](week-in-review-video.md); MP4 path untested. Still open: picks D (task detail modal vs rail) and E (phone FAB vs bottom-bar add).
- "/plugin-authoring" thread (resolved) had offered a mod (PR guard, dark-screenshot check, branch-name guard); user never picked.

## Index lines moved here 2026-10-31 (state as last written)
- "Release v0.3.4": waiting on the user's v0.3.4 tag and build; then AUR checksum PRs.
- Merged 2026-10-20, open until the user acknowledges, real-phone checks pending: #242 edit widgets, #239 predictive back, #241 recurring done, #240 board card size, #243 motion loops [phone-motion-loops](phone-motion-loops.md).
- "Phone chat composer flicker" (#244 MERGED 2026-10-21): open for a real-phone check or the app-wide press-dim fade fix, both offered [composer-flicker](composer-flicker.md).
- "Phone calendar ticks and lag" (#245 MERGED 2026-10-21 15:25): asks the user to try month/week swipes and opening an item in today's Day view on the phone; fixes go on a new branch [phone-calendar-fixes](phone-calendar-fixes.md).
- "Ways to ship Timely on Arch" (#246 MERGED 2026-10-21 15:26): .pacman ships from the next tag; user to confirm it appears in release assets; timely-bin still missing from AUR [arch-distribution-options](arch-distribution-options.md).
- "Select all and delete in phone docs": #247 merged into dev 2026-10-23 on the user's "merge it" (proof was emulated keyboard in Chrome; not checked on a real phone) [phone-doc-editor-android-keyboard](phone-doc-editor-android-keyboard.md).
- "API URL in the frontend": runtime API_ORIGIN everywhere, #248 (also fixes the Docker web image) MERGED 2026-10-23 [api-url-config](api-url-config.md).

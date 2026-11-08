---
name: phone-calendar-fixes
description: Phone calendar thread 2026-10-20 (circle tick, Agenda lag, month paging glitch, Day view scroll); branch, causes, what still needs the real phone, and web-harness gotchas
metadata:
  type: project
  modified: 2026-10-20T14:48:23.594Z
---
Thread "Phone calendar ticks and lag" (2026-10-20, user asked in "Poteto-mode"). Branch fix/phone-calendar-ticks-and-lag-s6ynvd, PR #245, merged into dev 2026-10-21 15:25 on the user's "Merge it" (CI green). Report + shots: /mnt/project-files/phone-calendar/ (report.md, cmp-*.png, scripts/ to reseed and re-measure).

- Circle on calendar rows was a plain View inside the row's press area, so it opened the sheet. Now TaskCheck + lib/calendarTick.ts `useTickCalendarItem` (occurrence for repeating, task for one-off, Undo). Today uses the same hook. useSaveTask patches calendar ranges and Today via contract `withTaskDone` when completedAt changes.
- Agenda rendered every row of 6 weeks (~7,300 web elements): now SectionList. Month to Agenda 3.06 s -> 0.24 s (web prod build, CPU 4x).
- Month view and DateStrip: 3-page ScrollView re-centred after each swipe (wrong month flash, height jump, possible double advance). Now components/calendar/PeriodPager.tsx (one FlatList, fixed slot per period); months always 6 weeks.
- Day view: contentOffset was recomputed from the clock every render; Android scrolls whenever contentOffset changes, so opening an item jumped back to now. Now set once per day.
- Untested (needs the phone, after the user pulls dev and runs make install-apk): month/week swipes, Day scroll fix, real Android speed. Thread stays open for that.

Gotchas for cloud testing of the phone app:
- react-native-web never fires onMomentumScrollEnd/onScrollEndDrag and ignores contentOffset, so swipe paging can't be tested on Expo web.
- `expo start --web --no-dev --minify` gives a production web build (better timings) but opens on "Connect to your Timely desktop"; type the API address into it.
- Access tokens last 30 min; re-login in long scripts.
- `pkill -f <pattern>` / `pgrep -f` kill the shell running them when the pattern is in the command; kill by pid from `ps -eo pid,args | awk`.
Related: [recurring-task-done](recurring-task-done.md) [cloud-dev-server-watchers](cloud-dev-server-watchers.md) [android-testing-on-user-pc](android-testing-on-user-pc.md)

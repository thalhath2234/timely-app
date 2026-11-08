---
name: widgets-standalone-pr-224
description: Phone widget local taps (RNWidgetLocal), sheet card builder stuck taps, stale APK bundle; gotchas from PR #224
metadata:
  type: project
---

PR #224 merged into dev 2026-10-18 (squash 62589e7).
- Standalone Pomodoro/Timer widgets keep state in filesDir/timely-widget-local-<id>.json; TIMELY_LOCAL taps redraw natively in the patched react-native-android-widget (patches/react-native-android-widget@0.22.1.patch). Root config must be native maps (JavaOnlyMap -> "Illegal type provided"); Robolectric harness doesn't catch it.
- Phone BottomSheet header uses PanResponder: an RNGH Pan could stay half-begun and cancel every later touch with movement (symptom: taps above a sheet's input don't react; dragging the header unsticks it).
- Card builder lag fixed by memoised grid cells + cached formula evaluator per sheet (packages/contract dashboardFiles.ts).
- scripts/build-apk.sh clears generated JS bundle: Gradle didn't rebuild it when only packages/ changed (shipped stale APK once).
- After an APK update, widget taps need Timely opened once (or HyperOS Autostart).
- User has two accounts: main on "Timely Dev" desktop app (port 48090, ~/.config/Timely Dev/logs/api.log), other on "Timely" (~/.config/Timely). Empty Dashboard once = wrong account.
- PR #226 merged 2026-10-18 (a067d15): sheet counter widget counts locally (lib/widgets/counter.ts), Save tick + auto-save on next JS redraw (kept), DecimalFormat {{count:pattern}} token + 'differs' in RNWidgetLocal. Habits/tasks/checklists need server.
- Native harness test: RN native maps don't load under Robolectric (drawWidget throws Error); WidgetDrawTest.drawAll always reports 4 pre-existing cuts (Overdue/Due-soon 2x2).
- Editing the pnpm patch with Python: open with newline='' (patch has CRLF lines), then pnpm install --offline to refresh the lock hash.
Related: [android-testing-on-user-pc](android-testing-on-user-pc.md) [android-features-pr-202](android-features-pr-202.md)

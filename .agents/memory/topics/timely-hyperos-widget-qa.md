---
name: timely-hyperos-widget-qa
description: "Testing Timely home-screen widgets on the user's real Xiaomi HyperOS phone over adb; launcher quirks and how to see real tap areas"
metadata:
  type: project
  modified: 2026-10-18T03:05:16.984Z
---

Findings from 2026-10-18 widget QA on the user's phone (XIG03, HyperOS, Android 15, 1080x2460). Widgets sit on home pages 2 and 3.

- The phone has a PIN; adb can't unlock it. Ask the user to unlock. Never press POWER to "wake": it sleeps an awake screen.
- Timely reaches its server over Tailscale; HyperOS kills the Tailscale app, and Timely then spins on Today. Ask the user to turn Tailscale on.
- HyperOS autoscales widgets (logcat `LauncherWidgetLayoutFactory autoScale ... scale 0.78`). react-native-android-widget places tap overlays in raw px, so they drift from the drawn buttons. To see the real tap areas, run `uiautomator dump` and read the `rn_widget_clickable_area` bounds.
- With the app process dead and Autostart off (appops MIUIOP(10008) ignore), every widget tap fails with "proc frequent died / startProcessLocked failed". All taps, including OPEN_URI ones, go through a broadcast.
- `am start` while the app is open can say "brought to front" without delivering the link; trust real widget taps and the `START u0 ... dat=` lines in logcat.
- HOME on the launcher goes to page 1. Go to page N by pressing HOME twice and then swiping left (N-1) times, and take a screenshot before tapping.
- `make install-apk` fails `check-release-bundle.js` on the bare "10.0.2.2" hostname in lib/server/config.ts (a false positive). The built APK is still at apps/mobile/timely-release-arm64.apk; install it with `adb install -r -d`.

- `adb install` over USB shows an Install prompt on HyperOS; if nobody taps it, it fails with INSTALL_FAILED_USER_RESTRICTED. Ask the user to tap Install, then retry.
- If the prompt never shows, check logcat for `lowmemorykiller: Kill 'com.miui.securitycenter'` (AdbInstallActivity). The phone (3.5 GB) kills the prompt instantly and clearing recents doesn't help. Workaround: `adb push` the APK to /sdcard/Download/timely-phone-check.apk, have the user install it from the Files app, then delete it.
- Never `adb shell input text` unless a text field is confirmed focused (`dumpsys input_method | grep mInputShown`). On 2026-10-18 stray key presses (Space activates the focused row) turned a real task into a weekly repeat. uiautomator dumps include screens stacked under the current one, so match by bounds or check a screenshot. Server request log: ~/.config/Timely Dev/logs/api.log; a "recurrence/store.go record not found" line marks a newly created repeat rule.
- `am kill` won't kill Timely while it's recently used or a pomodoro runs; a truly closed-app test needs HyperOS to kill it on its own.
- Tap widget buttons by their real bounds (uiautomator `rn_widget_clickable_area` content-desc), never fixed coordinates: once a layout change happened, a stray tap opened the app and ticked a real checklist item.
- The user's widgets are real data (Expenses 2026 sheet, "Timely bugs found" checklist, pomodoro): put back anything a test changes.

**Why:** each of these cost time or caused wrong conclusions during the session.
**How to apply:** read this before any phone widget check; see [timely-worktree-qa-environment](timely-worktree-qa-environment.md).

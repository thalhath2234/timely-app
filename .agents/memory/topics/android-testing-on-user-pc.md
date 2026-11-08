---
name: android-testing-on-user-pc
description: How to run Android checks for Timely (cloud has no SDK/KVM; user's PC via Remote Control)
metadata:
  type: reference
  modified: 2026-10-14T15:39:48.879Z
---
The cloud container has no Android SDK or KVM, so Android emulator checks run on the user's Arch PC through Remote Control in /home/thalhath/Dev/timely-app (device "archlinux (timely-app)"). The user said on 2026-10-14 that threads can test the Android app on their machine.
- Use a separate git worktree and own ports (API 8081) so the user's checkout and `make dev` (8080/4001) stay untouched; clean up the worktree, emulator and servers afterwards.
- Test in Expo Go on the emulator. A release APK build plus the emulator drove the PC down to ~600 MB free and the PC dropped offline mid-run (it also stopped the user's `make dev`); avoid native APK builds there.
- Remote Control on the PC needs Claude Code 2.1.302 or newer (2026-10-26 it had 2.1.284 and start_remote_control refused; still 2.1.284 on 2026-10-29 when the user asked to test feature/live-block-tools there); the PC is served by the Claude Desktop app, so the user updates the app and turns Remote Control off and on.
- If a Remote Control card errors on Allow, cancel it and post a fresh one; list_devices shows whether the folder is "served".
- Real phone (Xiaomi HyperOS, 3.5 GB RAM) via `make install-apk` in a worktree: HyperOS needs the user to tap Install. If no prompt appears and install fails INSTALL_FAILED_USER_RESTRICTED, low memory killed the Security app's AdbInstallActivity (logcat lowmemorykiller); ask the user to clear Recents (keep Tailscale) and retry once. If still killed (2026-10-18 it was), `adb push` the APK to Download/ and have the user install it from the Files app (worked).
**Why:** earlier OOM crashes on this PC (see desktop notes); emulator is ~2.5 GB.
**How to apply:** brief any thread doing real-Android checks with this. Related: [sixty-day-run](sixty-day-run.md).
- adb install often fails INSTALL_FAILED_USER_RESTRICTED when the phone is low on memory. Workaround: adb push APK to Downloads, user installs from Files.
- Blender on the PC; Remote Control can drive it headless. No task yet.

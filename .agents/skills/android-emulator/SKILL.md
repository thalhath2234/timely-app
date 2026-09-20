---
name: android-emulator
description: >-
  Starts and stops the Timely Android emulator under a 3G systemd memory cap
  with a 1536 MB guest. Use when launching an AVD, qemu, Expo Go, native
  mobile checks, or any Android emulator on this 16 GB machine.
---

# Memory-capped Android emulator

Unbounded qemu has OOM-killed this 16 GB host (no swap). Never start an AVD
directly.

## Hard rules

1. **Never** run `$ANDROID_HOME/emulator/emulator` or `qemu-system-*` in the agent shell.
2. **Always** start with `make emu-start` (systemd-run `--user`, `MemoryMax=3G`).
3. **Always** pass qemu `-memory 1536 -cores 2 -lowram`. Do not raise guest RAM.
4. **Always** stop when the check is done: `make emu-stop`. Do not leave qemu running.
5. Abort if `MemAvailable` is under **2.5G** before start. Do not retry unbounded.
6. Worktree testing: API **8081**, Metro **8082**. Never touch **8080** or **4001**.

## Commands

From the repo root:

```bash
make emu-start    # 3G cgroup + 1536 MB guest; waits until adb boot_completed
make emu-status   # MemoryMax / MemoryCurrent, adb, host RAM
make emu-stop     # required cleanup
```

Unit: `timely-emulator.service`  
Log: `/tmp/timely-emulator.log`  
Default AVD: `timely_pixel` (`ANDROID_AVD_HOME=~/.config/.android/avd`)

Override with `TIMELY_AVD`, `TIMELY_EMU_MEMORY` (MB), `TIMELY_EMU_MEMORY_MAX` (cgroup).

## After start

```bash
systemctl --user show timely-emulator.service -p MemoryMax -p MemoryCurrent
adb devices -l
```

`MemoryMax` must be `3G` (3221225472). If qemu is not in that unit, stop and use `make emu-start` — a process outside the cgroup bypasses the cap.

## Expo Go (native JS)

```bash
adb reverse tcp:8082 tcp:8082
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8082"
```

Mobile env for the emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8081`.

## Cleanup

Stop the emulator as soon as the requested check finishes (`make emu-stop`), even if Metro/API stay up.

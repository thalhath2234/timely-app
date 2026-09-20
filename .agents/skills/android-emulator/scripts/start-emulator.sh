#!/usr/bin/env bash
# Start the Timely Android emulator inside a 3G systemd cgroup.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/thalhath/.local/android-sdk}}"
ANDROID_SDK_ROOT="$ANDROID_HOME"
ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.config/.android/avd}"
AVD="${TIMELY_AVD:-timely_pixel}"
GUEST_MB="${TIMELY_EMU_MEMORY:-1536}"
MEMMAX="${TIMELY_EMU_MEMORY_MAX:-3G}"
UNIT=timely-emulator
LOG=/tmp/timely-emulator.log
WAIT=1
EMULATOR="$ANDROID_HOME/emulator/emulator"
ADB="$ANDROID_HOME/platform-tools/adb"
PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

for arg in "$@"; do
  case "$arg" in
    --no-wait|-n) WAIT=0 ;;
    --help|-h)
      echo "usage: $0 [--no-wait]"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "$EMULATOR" ]]; then
  echo "emulator not found at $EMULATOR (set ANDROID_HOME)" >&2
  exit 1
fi
if [[ ! -x "$ADB" ]]; then
  echo "adb not found at $ADB" >&2
  exit 1
fi

avail_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
if (( avail_kb < 2621440 )); then
  echo "abort: MemAvailable $((avail_kb / 1024))MB is under 2560MB; free RAM before starting qemu" >&2
  free -h >&2
  exit 2
fi

systemctl --user stop "$UNIT.service" 2>/dev/null || true
systemctl --user reset-failed "$UNIT.service" 2>/dev/null || true
"$ADB" emu kill >/dev/null 2>&1 || true
sleep 1

: > "$LOG"
export ANDROID_HOME ANDROID_SDK_ROOT ANDROID_AVD_HOME

systemd-run --user \
  --unit="$UNIT" \
  --collect \
  --no-block \
  --property=MemoryMax="$MEMMAX" \
  --property=MemoryAccounting=yes \
  --description="Timely Android emulator (${MEMMAX} cap, ${GUEST_MB}MB guest)" \
  --setenv=HOME="$HOME" \
  --setenv=USER="$USER" \
  --setenv=ANDROID_HOME="$ANDROID_HOME" \
  --setenv=ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT" \
  --setenv=ANDROID_AVD_HOME="$ANDROID_AVD_HOME" \
  --setenv=PATH="$PATH" \
  /bin/bash -lc "exec >>$LOG 2>&1; echo AVD=$AVD GUEST_MB=$GUEST_MB MEMMAX=$MEMMAX; exec \"$EMULATOR\" -avd \"$AVD\" -memory \"$GUEST_MB\" -cores 2 -lowram -no-window -gpu swiftshader_indirect -no-audio -no-boot-anim -no-snapshot-load -no-snapshot-save"

echo "started $UNIT.service"
echo "avd=$AVD guest=${GUEST_MB}MB cgroup=$MEMMAX log=$LOG"
systemctl --user show "$UNIT.service" -p MemoryMax -p ActiveState -p SubState --no-pager

if [[ "$WAIT" -eq 0 ]]; then
  exit 0
fi

echo "waiting for boot_completed..."
for i in $(seq 1 60); do
  boot=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  if [[ "$boot" == "1" ]]; then
    echo "BOOT_OK t=${i}"
    "$ADB" devices -l
    systemctl --user show "$UNIT.service" -p MemoryMax -p MemoryCurrent --no-pager
    exit 0
  fi
  if ! systemctl --user is-active "$UNIT.service" >/dev/null; then
    echo "emulator unit died; tail $LOG:" >&2
    tail -n 40 "$LOG" >&2 || true
    exit 1
  fi
  sleep 3
done

echo "BOOT_TIMEOUT; see $LOG" >&2
"$ADB" devices -l >&2 || true
exit 1

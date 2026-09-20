#!/usr/bin/env bash
# Stop the memory-capped Timely Android emulator.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/thalhath/.local/android-sdk}}"
ADB="$ANDROID_HOME/platform-tools/adb"
UNIT=timely-emulator

systemctl --user stop "$UNIT.service" 2>/dev/null || true
if [[ -x "$ADB" ]]; then
  "$ADB" emu kill >/dev/null 2>&1 || true
fi
sleep 1
systemctl --user reset-failed "$UNIT.service" 2>/dev/null || true

if pgrep -f 'emulator -avd timely_' >/dev/null 2>&1; then
  pkill -f 'emulator -avd timely_' || true
fi
if pgrep -x qemu-system-x86_64 >/dev/null 2>&1; then
  # Only the AVD qemu; the unit stop should already have reaped it.
  if systemctl --user is-active "$UNIT.service" >/dev/null 2>&1; then
    systemctl --user kill "$UNIT.service" || true
  fi
fi

echo "stopped $UNIT.service"
if [[ -x "$ADB" ]]; then
  "$ADB" devices
fi
pgrep -af 'qemu-system-x86_64|emulator -avd' || echo "no qemu leftover"

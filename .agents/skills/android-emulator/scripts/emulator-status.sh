#!/usr/bin/env bash
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/thalhath/.local/android-sdk}}"
ADB="$ANDROID_HOME/platform-tools/adb"
UNIT=timely-emulator
LOG=/tmp/timely-emulator.log

systemctl --user status "$UNIT.service" --no-pager || true
echo
systemctl --user show "$UNIT.service" -p MemoryMax -p MemoryCurrent -p ActiveState --no-pager || true
echo
free -h | head -2
echo
if [[ -x "$ADB" ]]; then
  "$ADB" devices -l
fi
echo
tail -n 20 "$LOG" 2>/dev/null || true

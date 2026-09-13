#!/usr/bin/env bash
# Launch a memory-capped Timely Android APK build via the build-mobile-apk skill.
#
# Usage:
#   ./build-apk.sh [API_URL]
#   ./build-apk.sh --no-wait [API_URL]
#
# If API_URL is omitted, EXPO_PUBLIC_API_URL from .env is used.
# The Gradle build runs under systemd-run (12G cap), not in this shell.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WAIT=1
API_URL=""

for arg in "$@"; do
  case "$arg" in
    --no-wait|-n) WAIT=0 ;;
    --help|-h)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown option: $arg" >&2
      echo "usage: $0 [--no-wait] [API_URL]" >&2
      exit 1
      ;;
    *) API_URL="$arg" ;;
  esac
done

SKILL_SCRIPT=""
for candidate in \
  "$HOME/.cursor/skills/build-mobile-apk/scripts/build-apk.sh" \
  "$SCRIPT_DIR/.agents/skills/build-mobile-apk/scripts/build-apk.sh" \
  "$SCRIPT_DIR/.cursor/skills/build-mobile-apk/scripts/build-apk.sh"
do
  if [[ -x "$candidate" ]]; then
    SKILL_SCRIPT="$candidate"
    break
  fi
done

if [[ -z "$SKILL_SCRIPT" ]]; then
  echo "Could not find build-apk.sh from the build-mobile-apk skill." >&2
  exit 1
fi

if [[ -n "$API_URL" ]]; then
  "$SKILL_SCRIPT" "$API_URL"
else
  "$SKILL_SCRIPT"
fi

UNIT=timely-apk-build.service
LOG=/tmp/timely-apk-build.log
APK_OUT=/home/thalhath/timely-release-arm64.apk

echo
echo "Watch with:"
echo "  systemctl --user status $UNIT"
echo "  tail -f $LOG"
echo "APK on success: $APK_OUT"

if [[ "$WAIT" -eq 0 ]]; then
  exit 0
fi

echo
echo "Waiting for $UNIT (Ctrl+C stops watching; the build keeps running)"
echo

tail -n +1 -F "$LOG" 2>/dev/null &
TAIL_PID=$!
trap 'kill "$TAIL_PID" 2>/dev/null || true' EXIT INT TERM

started=0
for _ in $(seq 1 40); do
  state=$(systemctl --user show "$UNIT" -p ActiveState --value 2>/dev/null || echo unknown)
  if [[ "$state" == "activating" || "$state" == "active" ]]; then
    started=1
    break
  fi
  sleep 0.25
done

if [[ "$started" -eq 1 ]]; then
  while true; do
    state=$(systemctl --user show "$UNIT" -p ActiveState --value 2>/dev/null || echo unknown)
    if [[ "$state" != "activating" && "$state" != "active" ]]; then
      break
    fi
    sleep 10
  done
fi

sleep 1
kill "$TAIL_PID" 2>/dev/null || true
wait "$TAIL_PID" 2>/dev/null || true
trap - EXIT INT TERM

echo
if grep -q '^EXIT=0$' "$LOG" 2>/dev/null && [[ -f "$APK_OUT" ]]; then
  echo "Build succeeded: $APK_OUT"
  ls -lh "$APK_OUT"
  if [[ -f "$SCRIPT_DIR/scripts/check-bundle-url.js" ]]; then
    node "$SCRIPT_DIR/scripts/check-bundle-url.js"
  fi
  exit 0
fi

echo "Build did not succeed. Last 40 log lines:" >&2
tail -n 40 "$LOG" >&2 || true
exit 1

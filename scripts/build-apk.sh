#!/usr/bin/env bash
# Launch a memory-capped Timely Android APK build via the build-mobile-apk skill.
#
# Usage:
#   scripts/build-apk.sh [API_URL]
#   scripts/build-apk.sh --no-wait [API_URL]
#   make build-apk [API_URL=...]
#
# If API_URL is omitted, EXPO_PUBLIC_API_URL from apps/mobile/.env.local (then .env) is used.
# The Gradle build runs under systemd-run (12G cap), not in this shell.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MOBILE_DIR="$REPO_ROOT/apps/mobile"
WAIT=1
API_URL=""

for arg in "$@"; do
  case "$arg" in
    --no-wait|-n) WAIT=0 ;;
    --help|-h)
      sed -n '2,10p' "$0"
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
  "$REPO_ROOT/.agents/skills/build-mobile-apk/scripts/build-apk.sh" \
  "$HOME/.cursor/skills/build-mobile-apk/scripts/build-apk.sh"
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

export TIMELY_MOBILE_DIR="$MOBILE_DIR"
if [[ -n "$API_URL" ]]; then
  "$SKILL_SCRIPT" "$API_URL"
else
  "$SKILL_SCRIPT"
fi

UNIT=timely-apk-build.service
LOG=/tmp/timely-apk-build.log
APK_OUT="${TIMELY_APK_OUT:-$REPO_ROOT/apps/mobile/timely-release-arm64.apk}"

echo
echo "Watch with:"
echo "  make apk-status"
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
  if [[ -f "$MOBILE_DIR/scripts/check-bundle-url.js" ]]; then
    node "$MOBILE_DIR/scripts/check-bundle-url.js"
  fi
  exit 0
fi

echo "Build did not succeed. Last 40 log lines:" >&2
tail -n 40 "$LOG" >&2 || true
exit 1

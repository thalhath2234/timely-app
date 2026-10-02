#!/usr/bin/env bash
# Launch a memory-capped Timely Android APK build via the build-mobile-apk skill.
#
# Usage:
#   scripts/build-apk.sh [--no-wait] [--api-url URL | --api-url=URL | URL]
#   API_URL=https://... scripts/build-apk.sh
#   make build-apk [API_URL=https://...]
#
# The API endpoint is taken from, in order: --api-url, the positional URL, the
# API_URL environment variable, then EXPO_PUBLIC_API_URL from the root .env. A
# trailing slash is removed. The Gradle build runs under systemd-run (12G cap),
# not in this shell.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MOBILE_DIR="$REPO_ROOT/apps/mobile"
WAIT=1
API_URL="${API_URL:-}"

usage() { echo "usage: $0 [--no-wait] [--api-url URL | URL]" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-wait|-n) WAIT=0 ;;
    --api-url=*) API_URL="${1#--api-url=}" ;;
    --api-url|-a)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "--api-url needs a value" >&2
        usage
        exit 1
      fi
      API_URL="$2"
      shift
      ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
    *) API_URL="$1" ;;
  esac
  shift
done

API_URL="${API_URL%/}"
if [[ -n "$API_URL" && ! "$API_URL" =~ ^https?:// ]]; then
  echo "API URL must start with http:// or https://: $API_URL" >&2
  exit 1
fi

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

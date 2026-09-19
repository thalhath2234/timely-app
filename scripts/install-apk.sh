#!/usr/bin/env bash
# Build the Timely Android APK (memory-capped) and install it on a connected phone.
#
# Usage:
#   scripts/install-apk.sh [API_URL]
#   make install-apk [API_URL=https://...]
#
# Requires USB debugging. If several devices are attached, set ANDROID_SERIAL.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APK_OUT=/home/thalhath/timely-release-arm64.apk
PACKAGE=com.timely.mobile
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/home/thalhath/.local/android-sdk}}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"

if [[ ! -x "$ADB" ]]; then
  echo "adb not found at $ADB (set ANDROID_HOME or ADB)" >&2
  exit 1
fi

BUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-wait|-n)
      echo "install-apk always waits for the build; ignoring $arg"
      ;;
    *) BUILD_ARGS+=("$arg") ;;
  esac
done

"$REPO_ROOT/scripts/build-apk.sh" "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}"

if [[ ! -f "$APK_OUT" ]]; then
  echo "APK missing after build: $APK_OUT" >&2
  exit 1
fi

pick_serial() {
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    echo "$ANDROID_SERIAL"
    return
  fi

  local devices=()
  local line serial state
  while IFS=$'\t' read -r serial state; do
    [[ -z "${serial:-}" ]] && continue
    if [[ "$state" == "device" ]]; then
      devices+=("$serial")
    fi
  done < <("$ADB" devices | awk 'NR>1 && $1 != "" {print $1 "\t" $2}')

  if [[ ${#devices[@]} -eq 0 ]]; then
    echo "No authorized Android device found. Plug in the phone, enable USB debugging, and accept the prompt." >&2
    "$ADB" devices -l >&2 || true
    exit 1
  fi
  if [[ ${#devices[@]} -gt 1 ]]; then
    echo "Multiple devices attached. Set ANDROID_SERIAL to one of:" >&2
    "$ADB" devices -l >&2 || true
    exit 1
  fi
  echo "${devices[0]}"
}

SERIAL=$(pick_serial)
MODEL=$("$ADB" -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)
echo
echo "Installing $APK_OUT on ${MODEL:-device} ($SERIAL)"

if ! "$ADB" -s "$SERIAL" install -r -d "$APK_OUT"; then
  echo "Install failed. If the existing app was signed differently, uninstall it first:" >&2
  echo "  $ADB -s $SERIAL uninstall $PACKAGE" >&2
  exit 1
fi

"$ADB" -s "$SERIAL" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || "$ADB" -s "$SERIAL" shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p "$PACKAGE" >/dev/null 2>&1 \
  || true

echo "Installed and launched $PACKAGE on ${MODEL:-device}"

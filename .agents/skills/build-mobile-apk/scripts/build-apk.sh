#!/usr/bin/env bash
set -euo pipefail

# Locate the mobile app. Works from the in-repo copy (<repo>/.agents/skills/...)
# and from the global copy (~/.cursor/skills/...). Override with TIMELY_MOBILE_DIR.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -n "${TIMELY_MOBILE_DIR:-}" ]]; then
  APP_DIR="$TIMELY_MOBILE_DIR"
elif [[ -f "$SCRIPT_DIR/../../../../apps/mobile/app.json" ]]; then
  APP_DIR=$(cd "$SCRIPT_DIR/../../../../apps/mobile" && pwd)
else
  APP_DIR=/home/thalhath/Dev/timely/apps/mobile
fi
if [[ ! -f "$APP_DIR/app.json" ]]; then
  echo "mobile app not found at $APP_DIR (set TIMELY_MOBILE_DIR)" >&2
  exit 1
fi

ANDROID_DIR="$APP_DIR/android"
JAVA_HOME=/home/thalhath/.local/jdk-17
ANDROID_HOME=/home/thalhath/.local/android-sdk
UNIT=timely-apk-build
LOG=/tmp/timely-apk-build.log
APK_OUT="${TIMELY_APK_OUT:-$APP_DIR/timely-release-arm64.apk}"
ANDROID_ARCHITECTURES="${TIMELY_ANDROID_ARCHITECTURES:-arm64-v8a}"
case "$ANDROID_ARCHITECTURES" in
  arm64-v8a|x86_64) ;;
  *) echo "unsupported Android architecture: $ANDROID_ARCHITECTURES" >&2; exit 1 ;;
esac
API_URL="${1:-}"

# The monorepo keeps one .env at the repo root (two levels above apps/mobile).
ENV_FILE="$(cd "$APP_DIR/../.." && pwd)/.env"

ENV_URL=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_URL=$(awk -F= '/^EXPO_PUBLIC_API_URL=/{sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE")
fi
API_URL="${API_URL:-$ENV_URL}"
API_URL="${API_URL%/}"
if [[ -z "$API_URL" ]]; then
  echo "missing API URL (pass as arg or set EXPO_PUBLIC_API_URL in $ENV_FILE)" >&2
  exit 1
fi

# Record the URL in the root .env, touching only its own line.
if [[ "$API_URL" != "$ENV_URL" ]]; then
  if grep -q '^EXPO_PUBLIC_API_URL=' "$ENV_FILE" 2>/dev/null; then
    updated=$(API_URL="$API_URL" awk '/^EXPO_PUBLIC_API_URL=/{print "EXPO_PUBLIC_API_URL=" ENVIRON["API_URL"]; next} {print}' "$ENV_FILE")
    printf '%s\n' "$updated" > "$ENV_FILE"
  else
    printf 'EXPO_PUBLIC_API_URL=%s\n' "$API_URL" >> "$ENV_FILE"
  fi
fi

mkdir -p "$APP_DIR/lib/api"
printf 'export const BUNDLED_API_URL = "%s";\n' "$API_URL" > "$APP_DIR/lib/api/bundledUrl.ts"
(cd "$APP_DIR" && node -e "require('./app.config.js')")

export JAVA_HOME ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
if [[ -x "$ANDROID_DIR/gradlew" ]]; then
  (cd "$ANDROID_DIR" && ./gradlew --stop) || true
fi
pkill -f 'org.gradle.launcher.daemon.bootstrap.GradleDaemon' || true

systemctl --user stop "$UNIT.service" 2>/dev/null || true
systemctl --user reset-failed "$UNIT.service" 2>/dev/null || true
: > "$LOG"

systemd-run --user \
  --unit="$UNIT" \
  --collect \
  --no-block \
  --working-directory="$APP_DIR" \
  --property=MemoryMax=12G \
  --property=MemoryAccounting=yes \
  --description="Timely Android APK build (12G cap)" \
  --setenv=HOME="$HOME" \
  --setenv=JAVA_HOME="$JAVA_HOME" \
  --setenv=ANDROID_HOME="$ANDROID_HOME" \
  --setenv=ANDROID_SDK_ROOT="$ANDROID_HOME" \
  --setenv=EXPO_PUBLIC_API_URL="$API_URL" \
  --setenv=NODE_ENV=production \
  --setenv=PATH="$JAVA_HOME/bin:/home/thalhath/.local/bin:$ANDROID_HOME/platform-tools:/usr/local/bin:/usr/bin" \
  /bin/bash -lc "
    exec >>$LOG 2>&1
    echo API_URL=$API_URL
    echo JAVA=\$(java -version 2>&1 | head -n1)
    if [ ! -x android/gradlew ]; then
      echo 'Generating Android project under the build memory cap'
      ./node_modules/.bin/expo prebuild --platform android --no-install
      status=\$?
      if [ \$status -ne 0 ]; then echo EXIT=\$status; exit \$status; fi
    fi
    cd android
    ./gradlew app:assembleRelease -PreactNativeArchitectures=$ANDROID_ARCHITECTURES --max-workers=2
    status=\$?
    if [ \$status -eq 0 ]; then cp -f app/build/outputs/apk/release/app-release.apk $APK_OUT; echo COPIED_APK=$APK_OUT; fi
    echo EXIT=\$status
    exit \$status
  "

echo "started $UNIT.service"
echo "app=$APP_DIR"
echo "api=$API_URL"
echo "log=$LOG"
echo "apk=$APK_OUT"
systemctl --user show "$UNIT.service" -p MemoryMax -p ActiveState -p SubState --no-pager

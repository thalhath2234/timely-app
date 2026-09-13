#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/thalhath/Dev/timely-mobile
ANDROID_DIR="$APP_DIR/android"
JAVA_HOME=/home/thalhath/.local/jdk-17
ANDROID_HOME=/home/thalhath/.local/android-sdk
UNIT=timely-apk-build
LOG=/tmp/timely-apk-build.log
APK_OUT=/home/thalhath/timely-release-arm64.apk
API_URL="${1:-}"

if [[ -z "$API_URL" && -f "$APP_DIR/.env" ]]; then
  API_URL=$(awk -F= '/^EXPO_PUBLIC_API_URL=/{print $2; exit}' "$APP_DIR/.env")
fi
API_URL="${API_URL%/}"
if [[ -z "$API_URL" ]]; then
  echo "missing API URL (pass as arg or set EXPO_PUBLIC_API_URL in $APP_DIR/.env)" >&2
  exit 1
fi

mkdir -p "$APP_DIR/lib/api"
cat > "$APP_DIR/.env" <<EOF
# Local API fallback (emulator): http://10.0.2.2:8080
# Local API fallback (iOS / web): http://localhost:8080
EXPO_PUBLIC_API_URL=$API_URL
EOF
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

UNIT_PATH="$PATH"
systemd-run --user \
  --unit="$UNIT" \
  --collect \
  --no-block \
  --working-directory="$ANDROID_DIR" \
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
  /bin/bash -lc "exec >>$LOG 2>&1; echo API_URL=$API_URL; echo JAVA=\$(java -version 2>&1 | head -n1); ./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2; status=\$?; if [ \$status -eq 0 ]; then cp -f app/build/outputs/apk/release/app-release.apk $APK_OUT; echo COPIED_APK=$APK_OUT; fi; echo EXIT=\$status; exit \$status"

echo "started $UNIT.service"
echo "api=$API_URL"
echo "log=$LOG"
echo "apk=$APK_OUT"
systemctl --user show "$UNIT.service" -p MemoryMax -p ActiveState -p SubState --no-pager
echo "PATH_FOR_UNIT=$UNIT_PATH" >/dev/null

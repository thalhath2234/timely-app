#!/usr/bin/env bash
# Draws every phone home screen widget with the widget library's real Android
# code (Robolectric, no phone or emulator) and fails when one can't be drawn or
# cuts something off. PNGs and report.json (tap areas, cut-offs) land in
# $WIDGET_OUT (default /tmp/timely-widget-test).
#
# Needs the generated Android project: run `make build-apk` once first.
# Optional env: JAVA_HOME, ANDROID_HOME, WIDGET_OUT, TIMELY_ROBOLECTRIC_REPO
# (a Maven Central mirror for Robolectric's Android jars) and
# TIMELY_GRADLE_INIT (an extra Gradle init script, e.g. a repository mirror).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HERE="$ROOT/scripts/mobile-widget-native"
ANDROID_DIR="$ROOT/apps/mobile/android"
if [[ ! -x "$ANDROID_DIR/gradlew" ]]; then
  echo "apps/mobile/android is missing; run \`make build-apk\` once to generate it" >&2
  exit 1
fi

# Same toolchain as the APK build when nothing else is set.
if [[ -z "${JAVA_HOME:-}" && -d /home/thalhath/.local/jdk-17 ]]; then export JAVA_HOME=/home/thalhath/.local/jdk-17; fi
if [[ -z "${ANDROID_HOME:-}" && -d /home/thalhath/.local/android-sdk ]]; then export ANDROID_HOME=/home/thalhath/.local/android-sdk; fi
export ANDROID_SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${JAVA_HOME:-}" ]] && export PATH="$JAVA_HOME/bin:$PATH"

export WIDGET_OUT="${WIDGET_OUT:-/tmp/timely-widget-test}"
export WIDGET_CASES="$WIDGET_OUT/cases.json"
export WIDGET_TEST_SRC="$HERE/java"
rm -rf "$WIDGET_OUT"
mkdir -p "$WIDGET_OUT"
node "$ROOT/scripts/mobile-widget-native/cases.mjs" "$WIDGET_CASES" 2>/dev/null

INIT=(--init-script "$HERE/init.gradle")
[[ -n "${TIMELY_GRADLE_INIT:-}" ]] && INIT+=(--init-script "$TIMELY_GRADLE_INIT")
GRADLE=(./gradlew "${INIT[@]}" --no-daemon --max-workers=1
  -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=1g"
  -PreactNativeArchitectures=arm64-v8a
  :app:testDebugUnitTest --tests com.timely.mobile.WidgetDrawTest --rerun)

cd "$ANDROID_DIR"
# Gradle (3 GB) plus the test JVM (3 GB): cap the pair like the APK build does.
if command -v systemd-run >/dev/null && systemctl --user is-system-running >/dev/null 2>&1; then
  systemd-run --user --scope --quiet -p MemoryMax=8G "${GRADLE[@]}"
else
  "${GRADLE[@]}"
fi
echo "Widget drawings: $WIDGET_OUT (report.json lists each widget's tap areas)"

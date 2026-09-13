---
name: build-mobile-apk
description: >-
  Builds the timely-mobile Android APK under systemd-run with a 12GB memory
  cap. Use whenever the user asks to build the mobile app, APK, Android
  release, Expo local production build, or to bake in a new API/ngrok URL.
---

# Build mobile APK (memory-capped)

Unbounded Gradle/Expo Android builds have OOM'd this machine. Never run them in the agent shell.

## Hard rules

1. **Never** run `./gradlew`, `npx expo run:android`, or `npx expo prebuild` APK/release builds directly.
2. **Always** launch the build detached with `systemd-run --user --no-block` and `MemoryMax=12G`.
3. **Always** stop existing `GradleDaemon` processes first (`./gradlew --stop`) so a new daemon starts **inside** the cgroup. A daemon outside the cap bypasses it.
4. Use **JDK 17** at `/home/thalhath/.local/jdk-17`. System Java 26 breaks Android `jlink`.
5. Build **arm64-v8a only** (`-PreactNativeArchitectures=arm64-v8a --max-workers=2`).
6. Bake the API URL with **no trailing slash** into `.env` (`EXPO_PUBLIC_API_URL`) and `lib/api/bundledUrl.ts` before building.

## Build

Run the skill script; do not hand-roll Gradle:

```bash
~/.cursor/skills/build-mobile-apk/scripts/build-apk.sh [API_URL]
```

If `API_URL` is omitted, the script uses `EXPO_PUBLIC_API_URL` from `timely-mobile/.env`.

Logs: `/tmp/timely-apk-build.log`  
Unit: `timely-apk-build.service`  
APK on success: `/home/thalhath/timely-release-arm64.apk`

## After launch

```bash
systemctl --user status timely-apk-build.service
systemctl --user show timely-apk-build.service -p MemoryMax -p MemoryCurrent
tail -n 40 /tmp/timely-apk-build.log
```

Do not poll the build in a tight loop. Confirm the unit is active and `MemoryMax=12G`, then wait on the log/unit. If it fails, read the log — do not retry unbounded.

## Verify

After `systemctl --user is-active` is `inactive` and the log ends with `EXIT=0`:

```bash
node /home/thalhath/Dev/timely-mobile/scripts/check-bundle-url.js
ls -lh /home/thalhath/timely-release-arm64.apk
```

The JS bundle must contain the https ngrok URL, not `10.0.2.2`.

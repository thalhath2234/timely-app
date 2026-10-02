---
name: build-mobile-apk
description: >-
  Builds the Timely mobile (apps/mobile) Android APK under systemd-run with a
  12GB memory cap, and optionally installs it on a connected phone. Use when
  the user asks to build the mobile app, APK, Android release, Expo local
  production build, bake in a new API/ngrok URL, or install the APK on a phone.
---

# Build mobile APK (memory-capped)

Unbounded Gradle/Expo Android builds have OOM'd this machine. Never run them in the agent shell.

The mobile app lives at `apps/mobile` in the `timely` monorepo (`/home/thalhath/Dev/timely`).

## Hard rules

1. **Never** run `./gradlew`, `npx expo run:android`, or `npx expo prebuild` APK/release builds directly.
2. **Always** launch the build detached with `systemd-run --user --no-block` and `MemoryMax=12G`.
3. **Always** stop existing `GradleDaemon` processes first (`./gradlew --stop`) so a new daemon starts **inside** the cgroup. A daemon outside the cap bypasses it.
4. Use **JDK 17** at `/home/thalhath/.local/jdk-17`. System Java 26 breaks Android `jlink`.
5. Build **arm64-v8a only** (`-PreactNativeArchitectures=arm64-v8a --max-workers=2`).
6. Bake the API URL with **no trailing slash** into the root `.env` (`EXPO_PUBLIC_API_URL`) and `apps/mobile/lib/api/bundledUrl.ts` before building.

## Build

From the repo root, use the Makefile (preferred) or the wrapper script; do not hand-roll Gradle:

```bash
make build-apk [API_URL=https://...]     # detached build + waits on the log
make install-apk [API_URL=https://...]   # build, then adb install + launch
scripts/build-apk.sh --no-wait [API_URL] # launch only
```

`make build-apk` / `scripts/build-apk.sh` call this skill's `scripts/build-apk.sh`.
`make install-apk` runs `scripts/install-apk.sh` after the capped build.
If `API_URL` is omitted, `EXPO_PUBLIC_API_URL` from the root `.env` is used.
The script finds the app relative to the repo; set `TIMELY_MOBILE_DIR` to override.

T3 Code action: `t3.json` script **Build & Install APK** runs `make install-apk`. Import it from the actions menu (**From t3.json**) if it is not already in the toolbar.

Logs: `/tmp/timely-apk-build.log`  
Unit: `timely-apk-build.service`  
APK on success: `/home/thalhath/timely-release-arm64.apk`

## After launch

```bash
make apk-status
systemctl --user show timely-apk-build.service -p MemoryMax -p MemoryCurrent
tail -n 40 /tmp/timely-apk-build.log
```

Do not poll the build in a tight loop. Confirm the unit is active and `MemoryMax=12G`, then wait on the log/unit. If it fails, read the log — do not retry unbounded.

## Verify

After `systemctl --user is-active` is `inactive` and the log ends with `EXIT=0`:

```bash
node apps/mobile/scripts/check-bundle-url.js
ls -lh /home/thalhath/timely-release-arm64.apk
```

The JS bundle must contain the https ngrok URL, not `10.0.2.2`.

## Install on a phone

After a successful build:

```bash
make install-apk
```

Requires USB debugging. One authorized device is used automatically; if several are attached, set `ANDROID_SERIAL`. Package: `com.timely.mobile`.

---
name: cloud-apk-build
description: How to build the Timely Android release APK inside the cloud container (no PC load), and its limits
metadata:
  type: reference
  modified: 2026-10-18T09:54:46.330Z
---
Building the phone APK in the cloud works (2026-10-18, PR #225, ~10 min on 4 cores):
- SDK: download cmdline-tools from dl.google.com to ~/android-sdk, then sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;27.1.12297006" "cmake;3.22.1". Java 21 is fine.
- `expo prebuild --platform android --clean --no-install` in apps/mobile, then `./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a`.
- Maven Central 429s: ~/.gradle/init.d/mirror.gradle that adds maven-central.storage-download.googleapis.com FIRST (addFirst) to settings pluginManagement (plus gradlePluginPortal()+google(), else plugins vanish), dependencyResolutionManagement, and every project's buildscript/repositories. Rewriting only repo.maven.apache.org URLs isn't enough (plugins.gradle.org redirects there).
- Signed with the Expo template debug key (SHA-1 5e8f1606...), same as the user's PC builds, so it updates in place.
- Getting it onto the PC failed: device_commit_files only takes SendUserFile uploads (not available to thread sessions) and not /mnt/project-files paths. So the phone install still needs a PC build via Remote Control.
**How to apply:** use for compile checks of Kotlin/native changes without touching the user's PC. Related: [android-testing-on-user-pc](android-testing-on-user-pc.md).

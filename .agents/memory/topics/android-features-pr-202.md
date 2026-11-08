---
name: android-features-pr-202
description: PR #202 phone Android features (widgets, live notification, quick actions, predictive back, shortcuts, settings redesign) - how it is built and what is open
metadata:
  type: project
  modified: 2026-10-15T13:41:07.088Z
---

PR #202 (branch feature/android-app-features-dm8i7o) MERGED into dev 2026-10-15 at the user's "merge". Thread "Android app features".

- Native bits live in the local Expo module apps/mobile/modules/timely-android plus plugins/withTimelyAndroid.js (predictive back, static shortcuts, specialUse foreground service running headless task "TimelyLiveActivity").
- apps/mobile/package.json main is index.ts; it imports lib/background/register before expo-router/entry so TaskManager tasks exist in headless starts.
- Widgets: react-native-android-widget; one renderer lib/widgets/render.tsx, models in lib/widgets/model.ts. Card workshop (#201) sheet/doc cards are widgets; a new card kind needs a case in sheetModel/docModel. "Add a row" still opens the Dashboard (needs typing).
- Interactive widgets (2026-10-15, user: "interactive things to be interactive"): buttons send clickAction TIMELY_ACTION to taskHandler (actions.ts pure, run.ts side effects). Live clocks via patches/react-native-android-widget@0.22.1.patch (Chronometer overlay on TextWidget clickAction="CHRONOMETER"; paused clocks stay bitmap text). timely-android scheduleWidgetRefresh exact alarm redraws at countdown end. After a patch, delete android/build/generated/autolinking or Gradle compiles the old path.
- Settings redesign = option 1 of 3 (artifact https://claude.ai/artifact/CeU1w7Ni4jdeKB3J91PwiS); widget options 2 "Material You" and 3 "Glance strip" offered. No pick yet.
- Cloud Gradle: Maven Central 429s; compile via an init-script mirror (maven-central.storage-download.googleapis.com). `make test-mobile-scrollbars` fails when a new ScrollView lacks hidden indicators.
- Stale native project (2026-10-15): the APK build only ran prebuild when android/gradlew was missing, so the user's phone lacked #202's plugins (label "timely-mobile", no shortcuts, no predictive back, notification icon fell back to a filled square). PR #205 (merged 2026-10-15) makes build-apk.sh fingerprint prebuild inputs and run `expo prebuild --clean` on change, adds pomodoro progress bar, module-owned icon timely_live_icon. User's phone: Xiaomi HyperOS 2, Android 15 (no Live Update chip).
- Widget render crash (PR #209, merged 2026-10-15): react-native-android-widget's buildWidgetTree throws on Fragments and on components returning null; render.tsx now expands the tree first (widgetTree()). scripts/mobile-widget-render.test.mjs runs every widget through the real builder. Quick add = capture bar (option 1 of 3; 2 Equal tiles, 3 Icon dock offered).
- Native widget check `make test-mobile-widgets-native` (Robolectric, fails on cut-offs). Android widget flex weights must be integers; budget uses measured heights (1.36x sp text, 1.52x Archivo).
- Back (PR #209, merged 2026-10-15): never read nav state at render (useRootNavigationState is not reactive); useBackSync listens to the container "state" event; rule in lib/backPlan.ts, tested per screen file.
- Back swipe (PR #212, merged 2026-10-17): pushed screens transparentModal on Android so the previous screen stays drawn. User wants NO finger-follow: page slides fully off when Android's back arrow arms, back when it disarms. TimelyBack.kt mirrors SystemUI BackPanelController (16dp arm, disarm on reversal after 300ms, re-arm 32dp); Android alone decides commit. AOSP sources were fetched from android15-release.
- Battery (PR #217, merged 2026-10-17): widgets have no updatePeriodMillis (background refresh + app + timer alarm redraw them); all widget API calls go through sharedLoads (15 s, cleared by refreshAllWidgets/taps; pass {fresh:false} to reuse); live loop idle 60 s, busy 6 s.
- Open: all real-phone checks (listed in the PR body) need the user's phone.

**Why:** later threads touching widgets, notifications or back handling start here.
**How to apply:** extend these files rather than adding parallel ones. [sixty-day-run](sixty-day-run.md) [design-system](design-system.md)

const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod, withMainActivity, withStringsXml, AndroidConfig } = require("expo/config-plugins");

/**
 * Native glue for modules/timely-android:
 * - MainActivity tells the predictive back callback when React Native runs its
 *   own default Back, so that Back doesn't loop back into the callback.
 * - Long-pressing the launcher icon offers New task, Capture, Ask Timely and Search.
 */

const BACK_HOOK = "expo.modules.timelyandroid.TimelyBack";

function withDefaultBackHook(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") throw new Error("withTimelyAndroid expects a Kotlin MainActivity");
    let src = mod.modResults.contents;
    if (src.includes(BACK_HOOK)) return mod;
    const wrapper = `override fun invokeDefaultOnBackPressed() {
    ${BACK_HOOK}.beginDefaultBack()
    try {
      timelyDefaultBack()
    } finally {
      ${BACK_HOOK}.endDefaultBack()
    }
  }

  private fun timelyDefaultBack() {`;
    if (/override fun invokeDefaultOnBackPressed\(\)\s*\{/.test(src)) {
      src = src.replace(/override fun invokeDefaultOnBackPressed\(\)\s*\{/, wrapper);
    } else {
      const end = src.lastIndexOf("}");
      src = `${src.slice(0, end)}
  ${wrapper}
    super.invokeDefaultOnBackPressed()
  }
${src.slice(end)}`;
    }
    mod.modResults.contents = src;
    return mod;
  });
}

const SHORTCUTS = [
  { id: "new_task", action: "new-task", short: "New task", long: "Add a task", glyph: ["M5 12h14", "M12 5v14"] },
  {
    id: "capture",
    action: "capture",
    short: "Capture",
    long: "Capture to Inbox",
    glyph: [
      "M22 12h-6l-2 3h-4l-2-3H2",
      "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    ],
  },
  {
    id: "ask",
    action: "ask",
    short: "Ask Timely",
    long: "Ask the assistant",
    glyph: [
      "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
    ],
  },
  { id: "search", action: "search", short: "Search", long: "Search everything", glyph: ["m21 21-4.34-4.34", "M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z"] },
];

// Shortcut icons: Timely violet disc, white Lucide glyph scaled into the centre.
function shortcutIcon(paths) {
  const strokes = paths
    .map(
      (d) => `    <path android:pathData="${d}" android:strokeColor="#FFFFFF" android:strokeWidth="2" android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000" />`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="48dp"
  android:height="48dp"
  android:viewportWidth="48"
  android:viewportHeight="48">
  <path android:pathData="M24,24m-24,0a24,24 0,1 1,48 0a24,24 0,1 1,-48 0" android:fillColor="#8B7CF7" />
  <group android:translateX="13" android:translateY="13" android:scaleX="0.9166" android:scaleY="0.9166">
${strokes}
  </group>
</vector>
`;
}

function withShortcutResources(config) {
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const res = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res");
      const pkg = config.android?.package;
      fs.mkdirSync(path.join(res, "xml"), { recursive: true });
      fs.mkdirSync(path.join(res, "drawable"), { recursive: true });
      for (const s of SHORTCUTS) {
        fs.writeFileSync(path.join(res, "drawable", `shortcut_${s.id}.xml`), shortcutIcon(s.glyph));
      }
      const items = SHORTCUTS.map(
        (s) => `  <shortcut
    android:shortcutId="${s.id}"
    android:enabled="true"
    android:icon="@drawable/shortcut_${s.id}"
    android:shortcutShortLabel="@string/shortcut_${s.id}_short"
    android:shortcutLongLabel="@string/shortcut_${s.id}_long">
    <intent
      android:action="android.intent.action.VIEW"
      android:targetPackage="${pkg}"
      android:targetClass="${pkg}.MainActivity"
      android:data="${config.scheme}://shortcut/${s.action}" />
  </shortcut>`,
      ).join("\n");
      fs.writeFileSync(
        path.join(res, "xml", "shortcuts.xml"),
        `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items}
</shortcuts>
`,
      );
      return mod;
    },
  ]);
}

function withShortcutStrings(config) {
  return withStringsXml(config, (mod) => {
    const strings = SHORTCUTS.flatMap((s) => [
      { $: { name: `shortcut_${s.id}_short`, translatable: "false" }, _: s.short },
      { $: { name: `shortcut_${s.id}_long`, translatable: "false" }, _: s.long },
    ]);
    mod.modResults = AndroidConfig.Strings.setStringItem(strings, mod.modResults);
    return mod;
  });
}

function withShortcutMetadata(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity["meta-data"] = (activity["meta-data"] ?? []).filter((m) => m.$["android:name"] !== "android.app.shortcuts");
    activity["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" } });
    return mod;
  });
}

module.exports = function withTimelyAndroid(config) {
  config = withDefaultBackHook(config);
  config = withShortcutResources(config);
  config = withShortcutStrings(config);
  config = withShortcutMetadata(config);
  return config;
};
module.exports.SHORTCUTS = SHORTCUTS;

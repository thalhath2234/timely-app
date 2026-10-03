const fs = require("fs");
const path = require("path");
const { withAndroidManifest } = require("expo/config-plugins");
const appJson = require("./app.json");

// The phone pairs with a Desktop host over plain http inside the Tailscale
// tunnel (ADR 0011). Android blocks cleartext by default and Expo has no
// built-in field for it, so this plugin sets the manifest attribute.
function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
}

function loadDotEnv(filename) {
  const file = path.join(__dirname, filename);
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

// Development convenience only: the phone pairs with a server at runtime
// (lib/server), so nothing here is required. `EXPO_PUBLIC_API_URL` from the
// process or the root .env pre-fills the address dev builds use on the
// emulator; the root .env is skipped for production builds so a release APK
// never picks up a developer's emulator address.
const fromProcess = (process.env.EXPO_PUBLIC_API_URL || "").trim();
const fromEnvFile = process.env.NODE_ENV === "production" ? "" : (loadDotEnv("../../.env").EXPO_PUBLIC_API_URL || "").trim();
const apiUrl = (fromProcess || fromEnvFile).replace(/\/+$/, "");

module.exports = {
  expo: {
    ...appJson.expo,
    // expo-sharing (SDK 57) registers its config plugin; `expo install --fix`
    // cannot write it into a dynamic config, so it is added here.
    plugins: [...(appJson.expo.plugins ?? []), "expo-sharing", withCleartextTraffic],
    extra: apiUrl ? { apiUrl } : {},
  },
};

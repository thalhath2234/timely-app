const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

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

// The monorepo keeps one .env at the repo root; Expo only reads env files from
// this directory, so the API URL is read here. Release builds write it there too.
const env = loadDotEnv("../../.env");
const fromEnvFile = env.EXPO_PUBLIC_API_URL || "";
const fromProcess = process.env.EXPO_PUBLIC_API_URL || "";
const emulatorOnly = fromProcess.includes("10.0.2.2") || fromProcess.includes("localhost");
const apiUrl = fromEnvFile || (emulatorOnly ? "" : fromProcess) || "";

module.exports = {
  expo: {
    ...appJson.expo,
    // expo-sharing (SDK 57) registers its config plugin; `expo install --fix`
    // cannot write it into a dynamic config, so it is added here.
    plugins: [...(appJson.expo.plugins ?? []), "expo-sharing"],
    extra: {
      apiUrl,
    },
  },
};

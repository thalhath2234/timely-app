const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

function loadDotEnv() {
  const file = path.join(__dirname, ".env");
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

const env = loadDotEnv();
const fromEnvFile = env.EXPO_PUBLIC_API_URL || "";
const fromProcess = process.env.EXPO_PUBLIC_API_URL || "";
const emulatorOnly = fromProcess.includes("10.0.2.2") || fromProcess.includes("localhost");
const apiUrl = fromEnvFile || (emulatorOnly ? "" : fromProcess) || "";

fs.mkdirSync(path.join(__dirname, "lib", "api"), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, "lib", "api", "bundledUrl.ts"),
  `export const BUNDLED_API_URL = ${JSON.stringify(apiUrl)};\n`,
);

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      apiUrl,
    },
  },
};

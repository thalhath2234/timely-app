/**
 * Development-only API address.
 *
 * Release builds never read this module: `lib/api/client.ts` requires it
 * inside an `if (__DEV__)` branch that Metro drops from production bundles,
 * and the phone learns its server at runtime from the desktop's QR code
 * (lib/server). Keep `BUNDLED_API_URL` empty in Git; nothing rewrites it.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

export const BUNDLED_API_URL = "";

function configuredDevUrl() {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  const fromEnv = process.env.EXPO_PUBLIC_API_URL || "";
  if (fromEnv.includes("10.0.2.2") || fromEnv.includes("localhost") || fromEnv.includes("127.0.0.1")) {
    return fromEnv;
  }
  return fromEnv || extra?.apiUrl || BUNDLED_API_URL || "";
}

function emulatorFallbackUrl() {
  if (Platform.OS === "android" && Constants.isDevice === false) return "http://10.0.2.2:8080";
  if (Platform.OS !== "android") return "http://localhost:8080";
  return "";
}

/**
 * `EXPO_PUBLIC_API_URL` (process env or the root `.env` via app.config.js),
 * else the emulator/simulator loopback. Empty on a physical Android device
 * with nothing configured, which sends the dev build to the connect screen.
 */
export function resolveDevApiUrl(): string {
  return (configuredDevUrl() || emulatorFallbackUrl()).replace(/\/+$/, "");
}

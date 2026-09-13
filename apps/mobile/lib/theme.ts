import { Appearance, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemeMode = "light" | "dark";

const THEME_PREFERENCE_KEY = "timely.theme.preference";

const darkColors = {
  background: "#1a1b22",
  foreground: "#ececf1",
  card: "#25262e",
  cardForeground: "#ececf1",
  popover: "#262733",
  primary: "#8b7cf7",
  primaryForeground: "#f7f5ff",
  secondary: "#2c2d36",
  muted: "#2c2d36",
  mutedForeground: "#9a9aa8",
  accent: "#3a3558",
  accentForeground: "#d4cff5",
  destructive: "#ef6b5c",
  success: "#4caf7a",
  warning: "#e8b54a",
  border: "rgba(255,255,255,0.09)",
  input: "rgba(255,255,255,0.12)",
  ring: "#8b7cf7",
} as const;

const lightColors = {
  background: "#f7f7fa",
  foreground: "#24242b",
  card: "#ffffff",
  cardForeground: "#24242b",
  popover: "#ffffff",
  primary: "#6657d9",
  primaryForeground: "#ffffff",
  secondary: "#eeeeF4",
  muted: "#eeeef3",
  mutedForeground: "#666674",
  accent: "#e9e6fb",
  accentForeground: "#5143b6",
  destructive: "#c63f35",
  success: "#28784f",
  warning: "#d79b22",
  border: "rgba(25,25,35,0.12)",
  input: "rgba(25,25,35,0.16)",
  ring: "#6657d9",
} as const;

export type ThemeColors = Record<keyof typeof darkColors, string>;

let activeTheme: ThemeMode = Appearance.getColorScheme() === "light" ? "light" : "dark";

function paletteFor(mode: ThemeMode): ThemeColors {
  return mode === "light" ? lightColors : darkColors;
}

// Direct color reads (icons and inline styles) always resolve from the active
// palette instead of capturing the device theme at module evaluation time.
export const colors = new Proxy({} as ThemeColors, {
  get: (_target, key: keyof ThemeColors) => paletteFor(activeTheme)[key],
});

// StyleSheets are evaluated lazily and cached once per palette. This avoids
// stale module-level styles when a saved theme is restored during bootstrap.
export function createThemedStyleSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>>(
  factory: (theme: ThemeColors) => T & StyleSheet.NamedStyles<unknown>,
): T {
  const cache: Partial<Record<ThemeMode, T>> = {};
  return new Proxy({} as T, {
    get: (_target, key: string | symbol) => {
      const themed = cache[activeTheme] ?? (cache[activeTheme] = StyleSheet.create(factory(paletteFor(activeTheme))));
      return themed[key as keyof T];
    },
  });
}

function applyTheme(mode: ThemeMode) {
  activeTheme = mode;
  Appearance.setColorScheme(mode);
}

export function getThemeMode() {
  return activeTheme;
}

export async function initializeTheme(): Promise<ThemeMode> {
  let saved: string | null = null;
  try {
    saved = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
  } catch {
    // Keep the device appearance when secure storage is unavailable.
  }
  const mode: ThemeMode = saved === "light" || saved === "dark" ? saved : activeTheme;
  applyTheme(mode);
  return mode;
}

export async function setThemePreference(mode: ThemeMode) {
  await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, mode);
  applyTheme(mode);
}

export const spacing = {
  headerTitle: 22,
  headerTitleCompact: 17,
  listTitle: 15,
  section: 12,
  tabLabel: 11,
} as const;

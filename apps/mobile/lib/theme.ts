import { useEffect, useState, type ReactNode } from "react";
import { Appearance, Platform, StyleSheet } from "react-native";
import * as SecureStore from "./secureStore";
import {
  ACCENT_PRESETS as SHARED_ACCENT_PRESETS,
  DEFAULT_ACCENT_HEX,
  darkColors,
  lightColors,
  radii,
  type ColorTokens,
} from "@timely/contract/designTokens";

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";
export type AccentPreference = "default" | `#${string}`;

export type AppearanceConfig = {
  theme: ThemePreference;
  accent: AccentPreference;
};

const APPEARANCE_CACHE_KEY = "timely.appearance";
const THEME_PREFERENCE_KEY = "timely.theme.preference";

export { DEFAULT_ACCENT_HEX } from "@timely/contract/designTokens";

/** Same swatches as the desktop app (packages/contract/src/designTokens.ts). */
export const ACCENT_PRESETS: { id: AccentPreference; label: string; hex: string }[] = [...SHARED_ACCENT_PRESETS];

// The phone uses the desktop palette. `muted`/`secondary` are filled control
// surfaces here (chips, select triggers, segmented tracks), which sit on cards,
// so they take the shared `fill` token; on desktop dark `muted` equals `card`.
function neutralsFrom(tokens: ColorTokens) {
  return {
    background: tokens.background,
    foreground: tokens.foreground,
    card: tokens.card,
    cardForeground: tokens.cardForeground,
    popover: tokens.popover,
    secondary: tokens.fill,
    muted: tokens.fill,
    mutedForeground: tokens.mutedForeground,
    destructive: tokens.destructive,
    destructiveForeground: tokens.destructiveForeground,
    destructiveContainer: tokens.destructiveContainer,
    success: tokens.success,
    warning: tokens.warning,
    border: tokens.border,
    input: tokens.input,
  };
}

function accentFrom(tokens: ColorTokens) {
  return {
    primary: tokens.primary,
    primaryForeground: tokens.primaryForeground,
    accent: tokens.accent,
    accentForeground: tokens.accentForeground,
    ring: tokens.ring,
  };
}

const darkNeutral = neutralsFrom(darkColors);
const lightNeutral = neutralsFrom(lightColors);
const darkDefaultAccent = accentFrom(darkColors);
const lightDefaultAccent = accentFrom(lightColors);

export type ThemeColors = Record<keyof typeof darkNeutral | keyof typeof darkDefaultAccent, string>;

/** Corner radius for cards, list rows and bars (desktop rounded-lg). */
export const radius = radii.card;
/** Corner radius for buttons, inputs, selects and segmented controls. */
export const controlRadius = radii.control;
/** Corner radius for bottom sheets and dialogs. */
export const sheetRadius = radii.sheet;

let activeTheme: ThemeMode = Appearance.getColorScheme() === "light" ? "light" : "dark";
let themePreference: ThemePreference = "system";
let accentPreference: AccentPreference = "default";
const listeners = new Set<() => void>();

function notifyTheme() {
  listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

export function normalizeHex(value: string): `#${string}` | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase() as `#${string}`;
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase() as `#${string}`;
  }
  return null;
}

function mixHex(a: string, b: string, amount: number) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return a;
  const t = Math.min(1, Math.max(0, amount));
  const channel = (i: number) => Math.round(left[i] + (right[i] - left[i]) * t);
  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function contrastForeground(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
  return luminance > 0.45 ? "#1a1523" : "#f7f5ff";
}

export function resolvedAccentHex(accent: AccentPreference = accentPreference) {
  if (accent === "default") return DEFAULT_ACCENT_HEX;
  return normalizeHex(accent) ?? DEFAULT_ACCENT_HEX;
}

function accentRamp(mode: ThemeMode, accent: AccentPreference): Pick<ThemeColors, "primary" | "primaryForeground" | "accent" | "accentForeground" | "ring"> {
  if (accent === "default") return mode === "light" ? lightDefaultAccent : darkDefaultAccent;
  const hex = resolvedAccentHex(accent);
  if (mode === "dark") {
    const primary = mixHex(hex, "#ffffff", 0.22);
    return {
      primary,
      primaryForeground: contrastForeground(primary),
      accent: mixHex(hex, "#1a1b22", 0.72),
      accentForeground: mixHex(hex, "#ffffff", 0.38),
      ring: primary,
    };
  }
  const primary = mixHex(hex, "#000000", 0.1);
  return {
    primary,
    primaryForeground: contrastForeground(primary),
    accent: mixHex(hex, "#ffffff", 0.86),
    accentForeground: mixHex(hex, "#000000", 0.28),
    ring: primary,
  };
}

function paletteFor(mode: ThemeMode, accent: AccentPreference = accentPreference): ThemeColors {
  const neutrals = mode === "light" ? lightNeutral : darkNeutral;
  return { ...neutrals, ...accentRamp(mode, accent) };
}

function resolveMode(preference: ThemePreference): ThemeMode {
  if (preference === "light" || preference === "dark") return preference;
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
}

export const colors = new Proxy({} as ThemeColors, {
  get: (_target, key: keyof ThemeColors) => paletteFor(activeTheme, accentPreference)[key],
});

export function createThemedStyleSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>>(
  factory: (theme: ThemeColors) => T & StyleSheet.NamedStyles<unknown>,
): T {
  const cache = new Map<string, T>();
  return new Proxy({} as T, {
    get: (_target, key: string | symbol) => {
      const cacheKey = `${activeTheme}:${resolvedAccentHex()}`;
      const themed = cache.get(cacheKey) ?? (() => {
        const created = StyleSheet.create(factory(paletteFor(activeTheme, accentPreference)));
        cache.set(cacheKey, created);
        return created;
      })();
      return themed[key as keyof T];
    },
  });
}

function applyAppearance(preference: ThemePreference, accent: AccentPreference, notify = true) {
  themePreference = preference;
  accentPreference = accent === "default" ? "default" : (normalizeHex(accent) ?? "default");
  activeTheme = resolveMode(preference);
  if (preference === "light" || preference === "dark") {
    Appearance.setColorScheme(preference);
  } else if (Platform.OS === "ios") {
    Appearance.setColorScheme(null as unknown as "light");
  }
  if (notify) notifyTheme();
}

export function getThemeMode() {
  return activeTheme;
}

export function getThemePreference() {
  return themePreference;
}

export function getAccentPreference() {
  return accentPreference;
}

export function editorThemeVars() {
  const palette = paletteFor(activeTheme, accentPreference);
  return {
    mode: activeTheme,
    background: palette.background,
    foreground: palette.foreground,
    muted: palette.muted,
    mutedForeground: palette.mutedForeground,
    primary: palette.primary,
    accent: palette.accent,
    accentForeground: palette.accentForeground,
    border: palette.border,
  };
}

async function writeCache(appearance: AppearanceConfig) {
  try {
    await SecureStore.setItemAsync(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // Keep the in-memory theme if secure storage is unavailable.
  }
}

function parseCachedAppearance(raw: string | null): AppearanceConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { theme?: string; accent?: string };
    const theme: ThemePreference =
      parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : "system";
    const accent: AccentPreference =
      parsed.accent === "default" ? "default" : (normalizeHex(parsed.accent ?? "") ?? "default");
    return { theme, accent };
  } catch {
    return null;
  }
}

export async function initializeTheme(): Promise<ThemeMode> {
  let cached: AppearanceConfig | null = null;
  try {
    const raw = await SecureStore.getItemAsync(APPEARANCE_CACHE_KEY);
    cached = parseCachedAppearance(raw);
    if (!cached) {
      const legacy = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
      if (legacy === "light" || legacy === "dark") cached = { theme: legacy, accent: "default" };
    }
  } catch {
    // Keep the device appearance when secure storage is unavailable.
  }
  applyAppearance(cached?.theme ?? themePreference, cached?.accent ?? accentPreference, false);
  return activeTheme;
}

export async function applyAccountAppearance(appearance: AppearanceConfig) {
  const theme: ThemePreference =
    appearance.theme === "light" || appearance.theme === "dark" || appearance.theme === "system"
      ? appearance.theme
      : "system";
  const accent: AccentPreference =
    appearance.accent === "default" ? "default" : (normalizeHex(appearance.accent) ?? "default");
  applyAppearance(theme, accent);
  await writeCache({ theme, accent });
}

export async function setThemePreference(mode: ThemeMode) {
  await applyAccountAppearance({ theme: mode, accent: accentPreference });
}

export async function setAppearancePreference(appearance: AppearanceConfig) {
  await applyAccountAppearance(appearance);
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeTheme(() => setTick((value) => value + 1));
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (themePreference !== "system") return;
      activeTheme = colorScheme === "light" ? "light" : "dark";
      notifyTheme();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
  return children;
}

export const spacing = {
  headerTitle: 22,
  headerTitleCompact: 17,
  listTitle: 15,
  section: 12,
  tabLabel: 11,
} as const;

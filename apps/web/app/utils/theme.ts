export type ThemePreference = "light" | "dark" | "system";
export type AccentPreference = "default" | `#${string}`;

export const THEME_STORAGE_KEY = "timely.theme";
export const ACCENT_STORAGE_KEY = "timely.accent";
export const SIDEBAR_AUTO_HIDE_STORAGE_KEY = "timely.sidebarAutoHide";

export const DEFAULT_ACCENT_HEX = "#6E56CF";

export const ACCENT_PRESETS: { id: AccentPreference; label: string; hex: string }[] = [
  { id: "default", label: "Violet", hex: DEFAULT_ACCENT_HEX },
  { id: "#3E63DD", label: "Indigo", hex: "#3E63DD" },
  { id: "#0090FF", label: "Blue", hex: "#0090FF" },
  { id: "#12A594", label: "Teal", hex: "#12A594" },
  { id: "#30A66D", label: "Green", hex: "#30A66D" },
  { id: "#F76808", label: "Orange", hex: "#F76808" },
  { id: "#E5484D", label: "Red", hex: "#E5484D" },
  { id: "#E93D82", label: "Pink", hex: "#E93D82" },
];

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
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

export function isAccentPreference(value: string | null): value is AccentPreference {
  if (value === "default") return true;
  return Boolean(value && normalizeHex(value));
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(saved) ? saved : "system";
}

export function readStoredAccent(): AccentPreference {
  if (typeof window === "undefined") return "default";
  const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
  if (saved === "default" || saved == null) return "default";
  return normalizeHex(saved) ?? "default";
}

export function readStoredSidebarAutoHide(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIDEBAR_AUTO_HIDE_STORAGE_KEY) === "true";
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function hexToOklch(hex: string): { l: number; c: number; h: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;

  const r = srgbToLinear(parseInt(normalized.slice(1, 3), 16));
  const g = srgbToLinear(parseInt(normalized.slice(3, 5), 16));
  const b = srgbToLinear(parseInt(normalized.slice(5, 7), 16));

  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(a * a + bLab * bLab);
  const hue = (Math.atan2(bLab, a) * 180) / Math.PI;

  return { l: L, c: C, h: hue < 0 ? hue + 360 : hue };
}

export function applyDocumentAppearance(theme: ThemePreference, accent: AccentPreference) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = theme === "dark" || (theme === "system" && media.matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";

  if (accent === "default") {
    root.classList.remove("theme-custom");
    root.style.removeProperty("--accent-hue");
    root.style.removeProperty("--accent-chroma");
    return;
  }

  const oklch = hexToOklch(accent);
  if (!oklch) {
    root.classList.remove("theme-custom");
    root.style.removeProperty("--accent-hue");
    root.style.removeProperty("--accent-chroma");
    return;
  }

  const chroma = oklch.c < 0.03 ? oklch.c : Math.min(0.24, Math.max(0.08, oklch.c));
  root.style.setProperty("--accent-hue", oklch.h.toFixed(2));
  root.style.setProperty("--accent-chroma", chroma.toFixed(4));
  root.classList.add("theme-custom");
}

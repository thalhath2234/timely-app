/**
 * Timely's design tokens, shared by the desktop/web app and the phone app.
 *
 * The web app declares the same colours as CSS variables in
 * apps/web/app/globals.css (`:root` and `.dark`); scripts/design-tokens.test.mjs
 * fails when the two drift. The phone theme (apps/mobile/lib/theme.ts) reads
 * these values directly. See docs/design-system.md for how the components use
 * them.
 */

export type ColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  /** Solid fill behind destructiveForeground (a delete button). */
  destructiveContainer: string;
  success: string;
  warning: string;
  border: string;
  input: string;
  ring: string;
  /**
   * Filled control surface that must stand out on a card (a select trigger, a
   * chip, a segmented track). On the light theme it equals `muted`; on dark,
   * `muted` equals `card`, so controls on cards need this one.
   */
  fill: string;
};

/** Keys mirrored as `--kebab-case` CSS variables in globals.css. */
export const CSS_COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "destructiveContainer",
  "success",
  "warning",
  "border",
  "input",
  "ring",
  "fill",
] as const satisfies readonly (keyof ColorTokens)[];

export const lightColors: ColorTokens = {
  background: "#f9fafb",
  foreground: "#171a24",
  card: "#ffffff",
  cardForeground: "#171a24",
  popover: "#ffffff",
  popoverForeground: "#171a24",
  primary: "#4f46e5",
  primaryForeground: "#f9fafe",
  secondary: "#eff0f4",
  secondaryForeground: "#252933",
  muted: "#eff0f4",
  mutedForeground: "#656972",
  accent: "#e9ecfb",
  accentForeground: "#373896",
  destructive: "#dc2627",
  destructiveForeground: "#fafafa",
  destructiveContainer: "#dc2627",
  success: "#179765",
  warning: "#df911a",
  border: "#e0e2e6",
  input: "#e0e2e6",
  ring: "#4f46e5",
  fill: "#eff0f4",
};

export const darkColors: ColorTokens = {
  background: "#111319",
  foreground: "#e2e2eb",
  card: "#191b22",
  cardForeground: "#e2e2eb",
  popover: "#191b22",
  popoverForeground: "#e2e2eb",
  primary: "#c0c1ff",
  primaryForeground: "#1000a9",
  secondary: "#1d1f26",
  secondaryForeground: "#e2e2eb",
  muted: "#191b22",
  mutedForeground: "#908fa0",
  accent: "#282a30",
  accentForeground: "#c0c1ff",
  destructive: "#ffb4ab",
  destructiveForeground: "#ffdad6",
  destructiveContainer: "#93000a",
  success: "#4edea3",
  warning: "#ffb95f",
  border: "rgba(255, 255, 255, 0.08)",
  input: "rgba(255, 255, 255, 0.12)",
  ring: "#c0c1ff",
  fill: "#24262e",
};

/** Hex shown for the "default" accent (light primary). */
export const DEFAULT_ACCENT_HEX = "#4F46E5";

/** The accent swatches in Settings > Appearance, same on both apps. */
export const ACCENT_PRESETS = [
  { id: "default", label: "Indigo", hex: DEFAULT_ACCENT_HEX },
  { id: "#6E56CF", label: "Violet", hex: "#6E56CF" },
  { id: "#0090FF", label: "Blue", hex: "#0090FF" },
  { id: "#12A594", label: "Teal", hex: "#12A594" },
  { id: "#30A66D", label: "Green", hex: "#30A66D" },
  { id: "#F76808", label: "Orange", hex: "#F76808" },
  { id: "#E5484D", label: "Red", hex: "#E5484D" },
  { id: "#E93D82", label: "Pink", hex: "#E93D82" },
] as const;

/**
 * Corner radii in px. Web: control = rounded-md, card = rounded-lg,
 * sheet = rounded-xl (from --radius 0.75rem).
 */
export const radii = {
  /** Buttons, inputs, selects, date fields, segmented controls. */
  control: 10,
  /** Cards, list rows, panels. */
  card: 12,
  /** Dialogs and bottom sheets. */
  sheet: 20,
} as const;

/**
 * Control heights in px. Desktop is pointer-first; the phone keeps a 44px
 * minimum touch target and uses `lg` for the one main action of a form.
 */
export const controlHeights = {
  desktop: { sm: 28, md: 32, lg: 36 },
  phone: { sm: 36, md: 44, lg: 48 },
} as const;

/** Font weights: no 700/800 outside the large phone title. */
export const fontWeights = { regular: "400", medium: "500", semibold: "600", title: "700" } as const;

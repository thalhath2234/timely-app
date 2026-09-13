import { Appearance } from "react-native";

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

// Components consume this shared token map. The native bundle selects the
// system palette at startup; no screen carries hard-coded theme colors.
export const colors = Appearance.getColorScheme() === "light" ? lightColors : darkColors;

export const spacing = {
  headerTitle: 22,
  headerTitleCompact: 17,
  listTitle: 15,
  section: 12,
  tabLabel: 11,
} as const;

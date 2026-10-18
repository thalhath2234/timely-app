/**
 * Shared look of every film scene. Scenes use inline styles only, so the
 * same code plays in the page (through @remotion/player) and renders to
 * video from Remotion Studio, where the site's stylesheet is absent.
 */

export const FPS = 30;
export const WIDTH = 1600;
export const HEIGHT = 1000;
/** Scenes lay out in this smaller space and are zoomed to fill the frame, so text stays legible once the Player scales the film down to page size. */
export const ZOOM = 1.25;
export const LW = WIDTH / ZOOM;
export const LH = HEIGHT / ZOOM;

export const C = {
  bg: "#0b0b0f",
  panel: "#121217",
  panel2: "#17171d",
  raised: "#1d1d25",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.14)",
  ink: "#f3f2f8",
  soft: "#a9a8b8",
  faint: "#7b7a90",
  accent: "#b8b7ff",
  accentDeep: "#6d6bf0",
  accentInk: "#15106b",
  green: "#30a66d",
  violet: "#6e56cf",
  amber: "#ffb224",
  blue: "#0090ff",
  pink: "#e93d82",
  cyan: "#00a2c7",
  orange: "#f76808",
  red: "#ff6b66",
} as const;

export const FONT = {
  sans: 'var(--font-geist-sans, Inter), Inter, "Segoe UI", system-ui, sans-serif',
  display: 'var(--font-site-display, "Bricolage Grotesque"), "Bricolage Grotesque", Inter, system-ui, sans-serif',
  mono: 'var(--font-geist-mono, "JetBrains Mono"), "JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;

/** A tinted fill for a block in a project colour. */
export function tint(color: string, amount = 0.18) {
  return `color-mix(in oklab, ${color} ${Math.round(amount * 100)}%, ${C.panel})`;
}

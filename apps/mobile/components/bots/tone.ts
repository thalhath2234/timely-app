import { colors, hexToRgb } from "../../lib/theme";

/** A theme colour at `alpha`, for washes and tinted borders. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : color;
}

/** "No change" marks and a person-paused dot: muted, still 3:1 on a card. */
export const quietGrey = () => withAlpha(colors.mutedForeground, 0.72);

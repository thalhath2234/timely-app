import type { CSSProperties } from "react";

/** Shared palette for workspaces, projects, and stages. */
export const ENTITY_COLORS = [
  "#30A66D",
  "#6E56CF",
  "#FFB224",
  "#0090FF",
  "#E93D82",
  "#00A2C7",
  "#F76808",
  "#AB4ABA",
  "#3E63DD",
  "#12A594",
  "#99D52A",
  "#E5484D",
] as const;

export const UNSTAGED_COLOR = "#889096";

/** Returns a palette color for any positive or negative index. */
export function colorForIndex(index: number): string {
  const n = Math.abs(index);
  return ENTITY_COLORS[n % ENTITY_COLORS.length];
}

/** Produces a stable unsigned hash for deterministic color selection. */
function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Maps an entity identifier to a stable palette color. */
export function stableColorForId(id?: string | null): string {
  if (!id) return UNSTAGED_COLOR;
  return colorForIndex(hashId(id));
}

/** Resolves a stored color or selects a deterministic palette fallback. */
export function resolvedColor(
  color?: string | null,
  fallbackId?: string | null,
  fallbackIndex = 0,
): string {
  const trimmed = color?.trim();
  if (trimmed) return trimmed;
  if (fallbackId) return stableColorForId(fallbackId);
  return colorForIndex(fallbackIndex);
}

/** Builds accessible foreground, border, and background styles for a color chip. */
export function chipStyle(color?: string | null): CSSProperties {
  if (!color) {
    return {
      backgroundColor: "var(--muted)",
      color: "var(--muted-foreground)",
      borderColor: "var(--border)",
    };
  }

  return {
    backgroundColor: `color-mix(in oklab, ${color} 18%, var(--card))`,
    color,
    borderColor: `color-mix(in oklab, ${color} 42%, var(--border))`,
  };
}

/** Builds border and background styles for a color-coded board lane. */
export function laneStyle(color?: string | null): CSSProperties {
  if (!color) {
    return {
      borderColor: "var(--border)",
      backgroundColor: "color-mix(in oklab, var(--muted) 40%, transparent)",
    };
  }

  return {
    borderColor: `color-mix(in oklab, ${color} 55%, var(--border))`,
    backgroundColor: `color-mix(in oklab, ${color} 10%, var(--card))`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 18%, transparent)`,
  };
}

/** Returns the fill style for a color-coded progress indicator. */
export function progressStyle(color?: string | null): CSSProperties {
  return {
    backgroundColor: color || "var(--primary)",
  };
}

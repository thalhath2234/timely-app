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

export function colorForIndex(index: number): string {
  const n = Math.abs(index);
  return ENTITY_COLORS[n % ENTITY_COLORS.length];
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function stableColorForId(id?: string | null): string {
  if (!id) return UNSTAGED_COLOR;
  return colorForIndex(hashId(id));
}

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

function parseHexRgb(color?: string | null): [number, number, number] | null {
  const hex = color?.trim().replace(/^#/, "");
  if (!hex) return null;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex.length === 8
        ? hex.slice(0, 6)
        : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** White or near-black so labels stay readable on a solid entity-color fill. */
export function contrastingTextColor(background?: string | null): string {
  const rgb = parseHexRgb(background);
  if (!rgb) return "var(--primary-foreground)";
  return relativeLuminance(rgb) > 0.179 ? "#111319" : "#ffffff";
}

export function fillStyle(color?: string | null): CSSProperties {
  return {
    backgroundColor: color || "var(--primary)",
    color: contrastingTextColor(color),
  };
}

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

export function progressStyle(color?: string | null): CSSProperties {
  return {
    backgroundColor: color || "var(--primary)",
  };
}

type ColorSource = {
  id?: string | null;
  color?: string | null;
};

export type TaskColorSource = {
  project?: ColorSource | null;
  projectId?: string | null;
  workspace?: ColorSource | null;
  workspaceId?: string | null;
};

/** Scan color for a task: project, then workspace, then a stable hash. */
export function taskEntityColor(task?: TaskColorSource | null): string {
  if (!task) return UNSTAGED_COLOR;
  if (task.project || task.projectId) {
    return resolvedColor(task.project?.color, task.project?.id ?? task.projectId);
  }
  return resolvedColor(task.workspace?.color, task.workspace?.id ?? task.workspaceId);
}

export function taskEntityLabel(task?: {
  project?: { title?: string | null } | null;
  workspace?: { name?: string | null } | null;
} | null): string {
  return task?.project?.title || task?.workspace?.name || "No project";
}

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

import type { Status } from "./types";

export function isCompletedStatus(status?: Status | null) {
  return Boolean(status && /done|complete/i.test(status.name));
}

export function statusNameKey(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

export type NamedStatusGroup = {
  key: string;
  name: string;
  color: string;
  statuses: Status[];
};

export function statusForWorkspace(
  group: NamedStatusGroup,
  workspaceId?: string | null,
): Status | undefined {
  if (!workspaceId) return group.statuses[0];
  return group.statuses.find((status) => status.workspaceId === workspaceId) ?? group.statuses[0];
}

export function statusPatch(status: Status, completedAt?: string | null) {
  const completing = isCompletedStatus(status);
  return {
    statusId: status.id,
    ...(completing && !completedAt
      ? { completedAt: new Date().toISOString() }
      : !completing && completedAt
        ? { completedAt: "" }
        : {}),
  };
}

export function mergeStatusesByName(statuses: Status[]) {
  const groups: NamedStatusGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const status of statuses) {
    const key = statusNameKey(status.name);
    if (!key) continue;
    const index = indexByKey.get(key);
    if (index == null) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        name: status.name.trim(),
        color: status.color,
        statuses: [status],
      });
      continue;
    }
    groups[index].statuses.push(status);
  }

  return groups;
}

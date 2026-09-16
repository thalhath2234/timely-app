import type { Status } from "@/app/_types/types";

export function isCompletedStatus(status?: Status | null) {
  return Boolean(status && /done|complete/i.test(status.name));
}

export function findCompletedStatus(statuses: Status[]) {
  return statuses.find(isCompletedStatus);
}

export function findDefaultStatus(statuses: Status[]) {
  return statuses.find((status) => status.isDefault) ?? statuses[0];
}

/** Case-insensitive key so "Todo" and "todo" share a Kanban column. */
export function statusNameKey(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

export type NamedStatusGroup = {
  key: string;
  name: string;
  color: string;
  statuses: Status[];
};

/** Collapse workspace-local statuses that share a name into one board column. */
export function mergeStatusesByName(statuses: Status[]): NamedStatusGroup[] {
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

export function statusForWorkspace(
  group: NamedStatusGroup,
  workspaceId?: string | null,
): Status | undefined {
  if (!workspaceId) return undefined;
  return group.statuses.find((status) => status.workspaceId === workspaceId);
}

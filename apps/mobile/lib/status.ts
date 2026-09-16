import type { Status } from "./types";

export function statusNameKey(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

export function mergeStatusesByName(statuses: Status[]) {
  const groups: { key: string; name: string; color: string; statuses: Status[] }[] = [];
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

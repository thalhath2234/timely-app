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

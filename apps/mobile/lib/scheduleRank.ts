import type { Task } from "./types";

/** Local emptiness check. The next-Work list comes from GET /schedule/rank. */
export function isUnscheduled(task: Task) {
  return (
    !task.completedAt &&
    task.kind !== "inbox" &&
    task.kind !== "reminder" &&
    (task.blocks?.length ?? 0) === 0 &&
    !task.scheduledOn
  );
}

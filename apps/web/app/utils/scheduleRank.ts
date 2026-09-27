import type { Task } from "@/app/_types/types";

/** Open Work with no Block on the current date. Prefer GET /schedule/rank
 * for the next-Work list; this is only a local emptiness check. */
export function isUnscheduled(task: Task) {
  return (
    !task.completedAt &&
    task.kind !== "inbox" &&
    task.kind !== "reminder" &&
    (task.blocks?.length ?? 0) === 0 &&
    !task.scheduledOn
  );
}

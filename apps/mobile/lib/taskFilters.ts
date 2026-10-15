import type { Task } from "./types";

// The filter engine is shared with the web app [natural-language views]; see
// @timely/contract/taskQuery for rules, sorting and grouping too.
export {
  DEFAULT_TASK_FILTERS,
  filterTasks,
  filtersFromView,
  isReminderTask,
  resolveViewOnlyDated,
  resolveViewShowCompleted,
  type TaskListFilters,
} from "@timely/contract/taskQuery";

export function isInboxTask(task: Task) {
  return task.kind === "inbox";
}

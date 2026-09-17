import type { Task, TaskViewConfig } from "./types";
import { isTaskOverdue } from "./overdue";
import { taskHasDate } from "./taskDates";

export type TaskListFilters = {
  workspaceIds: string[];
  statusIds: string[];
  projectIds: string[];
  priorityLevels: string[];
  labelIds: string[];
  stageIds: string[];
  showCompleted: boolean;
  onlyOverdue: boolean;
  onlyScheduled: boolean;
  onlyRecurring: boolean;
  onlyDated: boolean;
  showReminders: boolean;
};

export const MY_DEADLINES_VIEW_ID = "view_my_deadlines";

export function resolveViewOnlyDated(view: Pick<TaskViewConfig, "id" | "onlyDated">): boolean {
  if (typeof view.onlyDated === "boolean") return view.onlyDated;
  return view.id === MY_DEADLINES_VIEW_ID;
}

export function resolveViewShowCompleted(view: Pick<TaskViewConfig, "id" | "showCompleted">): boolean {
  if (typeof view.showCompleted === "boolean") return view.showCompleted;
  return view.id !== MY_DEADLINES_VIEW_ID;
}

export function isReminderTask(task: Task) {
  if (task.kind === "inbox") return false;
  if (task.kind === "reminder") return true;
  return (task.duration ?? 0) <= 0 && task.kind !== "task";
}

export function isInboxTask(task: Task) {
  return task.kind === "inbox";
}

export function filtersFromView(view: TaskViewConfig): TaskListFilters {
  return {
    workspaceIds: view.selectedWorkspaceIds ?? [],
    statusIds: view.selectedStatusIds ?? [],
    projectIds: view.selectedProjectIds ?? [],
    priorityLevels: view.selectedPriorityLevels ?? [],
    labelIds: view.selectedLabelIds ?? [],
    stageIds: view.selectedStageIds ?? [],
    showCompleted: resolveViewShowCompleted(view),
    onlyOverdue: Boolean(view.onlyOverdue),
    onlyScheduled: Boolean(view.onlyScheduled),
    onlyRecurring: Boolean(view.onlyRecurring),
    onlyDated: resolveViewOnlyDated(view),
    showReminders: Boolean(view.showReminders),
  };
}

function hasAny(values: string[]) {
  return values.length > 0;
}

export function filterTasks(tasks: Task[], filters: TaskListFilters): Task[] {
  const wantedWorkspaces = new Set(filters.workspaceIds);
  const wantedStatuses = new Set(filters.statusIds);
  const wantedProjects = new Set(filters.projectIds);
  const wantedPriorities = new Set(filters.priorityLevels);
  const wantedLabels = new Set(filters.labelIds);
  const wantedStages = new Set(filters.stageIds);

  return tasks.filter((task) => {
    if (task.kind === "inbox" || task.parentTaskId) return false;
    if (filters.showReminders) {
      if (!isReminderTask(task)) return false;
    } else if (isReminderTask(task)) {
      return false;
    }

    if (!filters.showCompleted && task.completedAt) return false;
    if (filters.onlyOverdue && !isTaskOverdue(task)) return false;
    if (filters.onlyScheduled && !task.scheduledOn && !(task.blocks && task.blocks.length > 0)) {
      return false;
    }
    if (filters.onlyRecurring && !task.recurrence) return false;
    if (filters.onlyDated && !taskHasDate(task)) return false;

    if (hasAny(filters.workspaceIds)) {
      const workspaceId = task.workspace?.id || task.workspaceId;
      if (!workspaceId || !wantedWorkspaces.has(workspaceId)) return false;
    }
    if (hasAny(filters.statusIds)) {
      const statusId = task.status?.id || task.statusId;
      if (!statusId || !wantedStatuses.has(statusId)) return false;
    }
    if (hasAny(filters.projectIds)) {
      const projectId = task.project?.id || task.projectId;
      if (!projectId || !wantedProjects.has(projectId)) return false;
    }
    if (hasAny(filters.priorityLevels)) {
      if (!task.priorityLevel || !wantedPriorities.has(task.priorityLevel)) return false;
    }
    if (hasAny(filters.labelIds)) {
      const ids = [
        ...(task.labels ?? []).map((label) => label.id),
        ...(task.labelIds ?? []).map((label) => label.id),
      ];
      if (!ids.some((id) => wantedLabels.has(id))) return false;
    }
    if (hasAny(filters.stageIds)) {
      if (!task.stageId || !wantedStages.has(task.stageId)) return false;
    }

    return true;
  });
}

import {
  CustomFieldValueInput,
  DocContent,
  RecurrenceInput,
  Task,
  TaskActivity,
} from "@/app/_types/types";
import { apiFetch } from "./client";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function getTasks(query: {
  kind?: string;
  inbox?: boolean;
  parentId?: string;
  includeSubtasks?: boolean;
  reminders?: boolean;
} = {}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.inbox) params.set("inbox", "true");
  if (query.parentId) params.set("parentId", query.parentId);
  if (query.includeSubtasks) params.set("includeSubtasks", "true");
  if (query.reminders) params.set("reminders", "true");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/tasks${suffix}`, {});

  if (!response.ok) {
    throw new Error("Failed to fetch tasks");
  }

  return response.json();
}

export async function getTask(id: string): Promise<Task> {
  const response = await apiFetch(`/task/${id}`, {});

  if (!response.ok) {
    throw new Error("Failed to fetch task");
  }

  return response.json();
}

export type CreateTaskCustomFieldValuePayload = CustomFieldValueInput;

export interface CreateTaskPayload {
  name: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  kind?: "task" | "reminder" | "inbox";
  parentTaskId?: string;
  deadline?: string;
  startDate?: string;
  scheduledOn?: string;
  workspaceId?: string;
  projectId?: string;
  statusId?: string;
  priorityLevel?: string;
  stageId?: string;
  blockedById?: string;
  labelIds?: { id: string }[];
  customFieldValues?: CreateTaskCustomFieldValuePayload[];
  /** Makes the task a repeating series. Omit for a one-off task. */
  recurrence?: RecurrenceInput;
}

export async function createTask(data: CreateTaskPayload): Promise<Task> {
  const response = await apiFetch("/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create task"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

/** Every field is optional so autosave can send just what changed. Passing an
 * empty string to a nullable field clears it. */
export interface UpdateTaskPayload {
  name?: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  kind?: "task" | "reminder" | "inbox";
  parentTaskId?: string | null;
  todayFocusOn?: string | null;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  contiguous?: boolean;
  earliestStartAt?: string | null;
  preferredWindows?: { days?: string[]; start: string; end: string }[];
  scheduleLocked?: boolean;
  deadline?: string;
  startDate?: string;
  scheduledOn?: string;
  completedAt?: string;
  workspaceId?: string;
  projectId?: string;
  statusId?: string;
  priorityLevel?: string;
  stageId?: string;
  blockedById?: string;
  /** Replaces the full label set. Pass `[]` to clear. */
  labelIds?: { id: string }[];
  /** Replaces the values of the fields listed. Blank values clear a field. */
  customFieldValues?: CustomFieldValueInput[];
  /** Replaces the recurrence rule; `null` turns the series back into a one-off. */
  recurrence?: RecurrenceInput | null;
}

export type TaskOccurrenceAction =
  | "complete"
  | "uncomplete"
  | "skip"
  | "restore"
  | "move";

export interface TaskOccurrencePayload {
  originalStart: string;
  action: TaskOccurrenceAction;
  newStart?: string;
  newEnd?: string;
}

/** Edits one instance of a recurring task without touching the series. */
export async function editTaskOccurrence(
  taskId: string,
  data: TaskOccurrencePayload,
): Promise<Task> {
  const response = await apiFetch(
    `/tasks/${taskId}/occurrences`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update occurrence"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export interface SplitTaskSeriesPayload {
  /** Original start of the first occurrence that moves to the new series. */
  fromStart: string;
  recurrence: Partial<RecurrenceInput>;
  name?: string;
  duration?: number;
}

/** "This and future": closes the series before `fromStart` and returns the new task. */
export async function splitTaskSeries(
  taskId: string,
  data: SplitTaskSeriesPayload,
): Promise<Task> {
  const response = await apiFetch(
    `/tasks/${taskId}/recurrence/split`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to split series"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function updateTask(
  id: string,
  data: UpdateTaskPayload,
): Promise<Task> {
  const response = await apiFetch(`/tasks/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update task"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function deleteTask(id: string): Promise<void> {
  const response = await apiFetch(`/tasks/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete task"));
  }
}

export async function bulkUpdateTasks(
  ids: string[],
  update: UpdateTaskPayload,
): Promise<Task[]> {
  const response = await apiFetch("/tasks/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, update }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update tasks"));
  }
  const resData = await response.json();
  return resData.tasks ?? resData;
}

export async function getTaskActivity(taskId: string): Promise<TaskActivity[]> {
  const response = await apiFetch(
    `/tasks/${taskId}/activity`,
    {},
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load activity"));
  }

  return response.json();
}

export async function addTaskComment(
  taskId: string,
  comment: string,
): Promise<TaskActivity> {
  const response = await apiFetch(
    `/tasks/${taskId}/activity`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to add comment"));
  }

  return response.json();
}

async function unwrapTask(response: Response, fallback: string): Promise<Task> {
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }
  const data = await response.json();
  return data.task ?? data;
}

export async function duplicateTask(id: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${id}/duplicate`, { method: "POST" });
  return unwrapTask(response, "Failed to duplicate task");
}

export async function addChecklistItem(taskId: string, title: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return unwrapTask(response, "Failed to add checklist item");
}

export async function updateChecklistItem(
  taskId: string,
  itemId: string,
  data: { title?: string; completed?: boolean },
): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return unwrapTask(response, "Failed to update checklist item");
}

export async function deleteChecklistItem(taskId: string, itemId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "DELETE",
  });
  return unwrapTask(response, "Failed to delete checklist item");
}

export async function startFocus(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/focus/start`, { method: "POST" });
  return unwrapTask(response, "Failed to start focus");
}

export async function stopFocus(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/focus/stop`, { method: "POST" });
  return unwrapTask(response, "Failed to stop focus");
}

export async function setTodayFocus(taskId: string, date: string | null): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/today-focus`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  return unwrapTask(response, "Failed to update today focus");
}

import type { CustomFieldValueInput, DocContent, RecurrenceInput, Task, TaskActivity } from "../types";
import { api, unwrap } from "./client";

export type CreateTaskPayload = {
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
  customFieldValues?: CustomFieldValueInput[];
  recurrence?: RecurrenceInput;
};

export type UpdateTaskPayload = {
  name?: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  kind?: "task" | "reminder" | "inbox";
  parentTaskId?: string | null;
  todayFocusOn?: string | null;
  deadline?: string | null;
  startDate?: string | null;
  scheduledOn?: string | null;
  completedAt?: string | null;
  projectId?: string | null;
  statusId?: string | null;
  priorityLevel?: string | null;
  workspaceId?: string | null;
  stageId?: string | null;
  blockedById?: string | null;
  labelIds?: { id: string }[];
  customFieldValues?: CustomFieldValueInput[];
  recurrence?: RecurrenceInput | null;
};

export type TaskOccurrenceAction = "complete" | "uncomplete" | "skip" | "restore" | "move";

export function getTasks(query: { inbox?: boolean; parentId?: string; kind?: string } = {}) {
  const params = new URLSearchParams();
  if (query.inbox) params.set("inbox", "true");
  if (query.parentId) params.set("parentId", query.parentId);
  if (query.kind) params.set("kind", query.kind);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return api<Task[]>(`/tasks${suffix}`);
}

export function getTask(id: string) {
  return api<Task>(`/task/${encodeURIComponent(id)}`);
}

export async function createTask(data: CreateTaskPayload) {
  const res = await api<Task | { task: Task }>("/tasks", { method: "POST", body: data });
  return unwrap(res, "task");
}

export async function updateTask(id: string, data: UpdateTaskPayload) {
  const res = await api<Task | { task: Task }>(`/tasks/${id}`, { method: "PUT", body: data });
  return unwrap(res, "task");
}

export async function bulkUpdateTasks(ids: string[], update: UpdateTaskPayload) {
  const res = await api<{ tasks: Task[] } | Task[]>("/tasks/bulk", {
    method: "PATCH",
    body: { ids, update },
  });
  return Array.isArray(res) ? res : res.tasks;
}

export function deleteTask(id: string) {
  return api<void>(`/tasks/${id}`, { method: "DELETE" });
}

export function getTaskActivity(taskId: string) {
  return api<TaskActivity[]>(`/tasks/${taskId}/activity`);
}

export function addTaskComment(taskId: string, comment: string) {
  return api<TaskActivity>(`/tasks/${taskId}/activity`, { method: "POST", body: { comment } });
}

export async function editTaskOccurrence(
  taskId: string,
  data: { originalStart: string; action: TaskOccurrenceAction; newStart?: string; newEnd?: string },
) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/occurrences`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "task");
}

export async function splitTaskSeries(
  taskId: string,
  data: { fromStart: string; recurrence?: RecurrenceInput; name?: string; duration?: number },
) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/recurrence/split`, {
    method: "POST",
    body: data,
  });
  return unwrap(res, "task");
}

export async function duplicateTask(id: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${id}/duplicate`, { method: "POST" });
  return unwrap(res, "task");
}

export async function addChecklistItem(taskId: string, title: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/checklist`, {
    method: "POST",
    body: { title },
  });
  return unwrap(res, "task");
}

export async function updateChecklistItem(
  taskId: string,
  itemId: string,
  data: { title?: string; completed?: boolean },
) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "PATCH",
    body: data,
  });
  return unwrap(res, "task");
}

export async function deleteChecklistItem(taskId: string, itemId: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/checklist/${itemId}`, {
    method: "DELETE",
  });
  return unwrap(res, "task");
}

export async function startFocus(taskId: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/focus/start`, { method: "POST" });
  return unwrap(res, "task");
}

export async function stopFocus(taskId: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/focus/stop`, { method: "POST" });
  return unwrap(res, "task");
}

export async function setTodayFocus(taskId: string, date: string | null) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/today-focus`, {
    method: "PUT",
    body: { date },
  });
  return unwrap(res, "task");
}

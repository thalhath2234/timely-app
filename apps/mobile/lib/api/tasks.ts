import type { Task, TaskActivity } from "../types";
import type {
  CreateTaskPayload,
  SplitTaskSeriesPayload,
  TaskOccurrenceAction,
  TaskOccurrencePayload,
  UpdateTaskPayload as WireUpdateTaskPayload,
} from "@timely/contract/entities";
import { api, unwrap } from "./client";
import { clearNulls, type Clearable } from "./clearable";

export type {
  CreateTaskPayload,
  SplitTaskSeriesPayload,
  TaskOccurrenceAction,
  TaskOccurrencePayload,
};

/** Fields a screen clears with `null`; `clearNulls` sends them as "" (0 for minutes). */
const CLEARABLE_TASK_FIELDS = [
  "todayFocusOn",
  "preferredChunkMinutes",
  "earliestStartAt",
  "deadline",
  "startDate",
  "scheduledOn",
  "completedAt",
  "workspaceId",
  "projectId",
  "statusId",
  "priorityLevel",
  "stageId",
  "blockedById",
] as const;

/** `UpdateTaskPayload` from the contract, plus `null` meaning "clear" on the fields above. */
export type UpdateTaskPayload = Clearable<WireUpdateTaskPayload, (typeof CLEARABLE_TASK_FIELDS)[number]>;

function wireTaskUpdate(data: UpdateTaskPayload): WireUpdateTaskPayload {
  return clearNulls<WireUpdateTaskPayload>(data, CLEARABLE_TASK_FIELDS, ["preferredChunkMinutes"]);
}

export function getTasks(query: { inbox?: boolean; reminders?: boolean; kind?: string } = {}) {
  const params = new URLSearchParams();
  if (query.inbox) params.set("inbox", "true");
  if (query.reminders) params.set("reminders", "true");
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

export async function captureInbox(name: string) {
  const res = await api<Task | { task: Task }>("/inbox", { method: "POST", body: { name } });
  return unwrap(res, "task");
}

export async function clarifyInbox(inboxId: string, data: CreateTaskPayload) {
  const res = await api<Task | { task: Task }>(`/inbox/${encodeURIComponent(inboxId)}/clarify`, {
    method: "POST",
    body: data,
  });
  return unwrap(res, "task");
}

export async function updateTask(id: string, data: UpdateTaskPayload) {
  const safeOffline = Object.keys(data).every((key) => key === "completedAt" || key === "todayFocusOn" || key === "scheduleLocked");
  const res = await api<Task | { task: Task }>(`/tasks/${id}`, { method: "PUT", body: wireTaskUpdate(data), queueIfOffline: safeOffline });
  return unwrap(res, "task");
}

export async function bulkUpdateTasks(ids: string[], update: UpdateTaskPayload) {
  const res = await api<{ tasks: Task[] } | Task[]>("/tasks/bulk", {
    method: "PATCH",
    body: { ids, update: wireTaskUpdate(update) },
    queueIfOffline: Object.keys(update).every((key) => key === "completedAt"),
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
  data: TaskOccurrencePayload,
) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/occurrences`, {
    method: "PUT",
    body: data,
    queueIfOffline: data.action !== "move",
  });
  return unwrap(res, "task");
}

export async function splitTaskSeries(
  taskId: string,
  data: SplitTaskSeriesPayload,
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
    queueIfOffline: Object.keys(data).every((key) => key === "completed"),
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

export async function pauseFocus(taskId: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/focus/pause`, { method: "POST" });
  return unwrap(res, "task");
}

export async function setTodayFocus(taskId: string, date: string | null) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/today-focus`, {
    method: "PUT",
    body: { date },
    queueIfOffline: true,
  });
  return unwrap(res, "task");
}

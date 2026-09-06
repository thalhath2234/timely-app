import type { CustomFieldValueInput, DocContent, RecurrenceInput, Task, TaskActivity } from "../types";
import { api, unwrap } from "./client";

export type CreateTaskPayload = {
  name: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  deadline?: string;
  startDate?: string;
  scheduledOn?: string;
  workspaceId?: string;
  projectId?: string;
  statusId?: string;
  priorityLevel?: string;
  scheduleId?: string;
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

export function getTasks() {
  return api<Task[]>("/tasks");
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

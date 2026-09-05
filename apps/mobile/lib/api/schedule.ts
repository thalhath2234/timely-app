import type { CalendarRange, ScheduledBlock, SchedulePlan, Task, WorkingHours } from "../types";
import { deviceTimezone } from "../format";
import { api, unwrap } from "./client";

export function getCalendarRange(from: Date, to: Date) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return api<CalendarRange>(`/calendar?${params.toString()}`);
}

export function getWorkingHours() {
  const params = new URLSearchParams({ tz: deviceTimezone() });
  return api<WorkingHours>(`/schedule/working-hours?${params.toString()}`);
}

export function updateWorkingHours(data: WorkingHours) {
  return api<WorkingHours>("/schedule/working-hours", {
    method: "PUT",
    body: { timezone: data.timezone, days: data.days },
  });
}

export type PlanRequest = {
  taskIds?: string[];
  from?: string;
  to?: string;
  includeManual?: boolean;
};

export function previewSchedule(data: PlanRequest = {}) {
  return api<SchedulePlan>("/schedule/preview", {
    method: "POST",
    body: { ...data, timezone: deviceTimezone() },
  });
}

export function applySchedule(data: PlanRequest = {}) {
  return api<SchedulePlan>("/schedule/apply", {
    method: "POST",
    body: { ...data, timezone: deviceTimezone() },
  });
}

export type AddBlockPayload = {
  start: string;
  end?: string;
  durationMinutes?: number;
  replace?: boolean;
};

export async function addTaskBlock(taskId: string, data: AddBlockPayload) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/blocks`, { method: "POST", body: data });
  return unwrap(res, "task");
}

export async function clearTaskBlocks(taskId: string) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/blocks`, { method: "DELETE" });
  return unwrap(res, "task");
}

export async function moveBlock(blockId: string, data: { start: string; end?: string }) {
  const res = await api<ScheduledBlock | { block: ScheduledBlock }>(`/blocks/${blockId}`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "block");
}

export function deleteBlock(blockId: string) {
  return api<void>(`/blocks/${blockId}`, { method: "DELETE" });
}

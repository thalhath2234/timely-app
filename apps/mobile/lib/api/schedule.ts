import type {
  CalendarRange,
  DayCapacity,
  ScheduledBlock,
  SchedulePlan,
  ScheduleSettings,
  Task,
  TodayResponse,
  WorkingHours,
  WorkingHoursResponse,
} from "../types";
import type {
  AddBlockPayload,
  PlanRequest as WirePlanRequest,
} from "@timely/contract/schedule";
import { deviceTimezone } from "../format";
import { api, unwrap } from "./client";

export type { AddBlockPayload };
/** What callers choose; `timezone` is the device's, added on send. */
export type PlanRequest = Omit<WirePlanRequest, "timezone">;

export function getCalendarRange(from: Date, to: Date) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return api<CalendarRange>(`/calendar?${params.toString()}`);
}

export function getWorkingHours() {
  const params = new URLSearchParams({ tz: deviceTimezone() });
  return api<WorkingHoursResponse>(`/schedule/working-hours?${params.toString()}`);
}

export function updateWorkingHours(data: WorkingHours) {
  return api<WorkingHoursResponse>("/schedule/working-hours", {
    method: "PUT",
    body: { timezone: data.timezone, days: data.days },
  });
}

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

export function undoSchedule() {
  return api<SchedulePlan>("/schedule/undo", { method: "POST" });
}

export function getScheduleSettings() {
  return api<ScheduleSettings>("/schedule/settings");
}

export function updateScheduleSettings(data: Partial<ScheduleSettings>) {
  return api<ScheduleSettings>("/schedule/settings", { method: "PUT", body: data });
}

export type RankedTask = {
  task: Task;
  score: number;
  reasons: string[];
};

export async function getRank() {
  // Same day boundary as Auto-schedule for accounts without saved Working hours.
  const params = new URLSearchParams({ timezone: deviceTimezone() });
  const body = await api<{ items?: RankedTask[] }>(`/schedule/rank?${params}`);
  return body.items ?? [];
}

export async function getCapacity(from: Date, to: Date) {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: deviceTimezone(),
  });
  const body = await api<{ days?: DayCapacity[] } | DayCapacity[]>(`/schedule/capacity?${params}`);
  return Array.isArray(body) ? body : body.days ?? [];
}

export async function pinTask(taskId: string, locked: boolean) {
  const res = await api<Task | { task: Task }>(`/tasks/${taskId}/schedule-lock`, {
    method: "PUT",
    body: { locked },
  });
  return unwrap(res, "task");
}

export async function pinBlock(blockId: string, locked: boolean) {
  const res = await api<ScheduledBlock | { block: ScheduledBlock }>(`/blocks/${blockId}/lock`, {
    method: "PUT",
    body: { locked },
  });
  return unwrap(res, "block");
}

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

export function getToday(date?: string) {
  const params = new URLSearchParams({ tz: deviceTimezone() });
  if (date) params.set("date", date);
  params.set("timezone", deviceTimezone());
  return api<TodayResponse>(`/today?${params.toString()}`);
}

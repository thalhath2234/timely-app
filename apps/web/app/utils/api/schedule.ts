import {
  CalendarRange,
  DayCapacity,
  ScheduledBlock,
  SchedulePlan,
  ScheduleSettings,
  Task,
  TodayResponse,
  WorkingHours,
} from "@/app/_types/types";
import { apiFetch } from "./client";

export type RankedTask = {
  task: Task;
  score: number;
  reasons: string[];
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

/** Browser zone, sent so server-side expansion matches what the user sees. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Everything on the calendar between two instants: blocks, events, occurrences. */
export async function getCalendarRange(
  from: Date,
  to: Date,
): Promise<CalendarRange> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const response = await apiFetch(`/calendar?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load calendar"));
  }
  return response.json();
}

export async function getWorkingHours(): Promise<WorkingHours> {
  const params = new URLSearchParams({ tz: browserTimezone() });
  const response = await apiFetch(
    `/schedule/working-hours?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load working hours"));
  }
  return response.json();
}

export async function updateWorkingHours(
  data: WorkingHours,
): Promise<WorkingHours> {
  const response = await apiFetch(`/schedule/working-hours`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: data.timezone, days: data.days }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to save working hours"));
  }
  return response.json();
}

export interface PlanRequest {
  /** Limit the run to these tasks; omit for every schedulable task. */
  taskIds?: string[];
  from?: string;
  to?: string;
  /** Let the engine replace blocks the user placed by hand. */
  includeManual?: boolean;
}

function planBody(data: PlanRequest) {
  return JSON.stringify({ ...data, timezone: browserTimezone() });
}

/** Dry run: what the engine would place, without writing anything. */
export async function previewSchedule(
  data: PlanRequest = {},
): Promise<SchedulePlan> {
  const response = await apiFetch(`/schedule/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: planBody(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to preview schedule"));
  }
  return response.json();
}

/** Rebuilds engine-owned blocks for the tasks in scope. */
export async function applySchedule(
  data: PlanRequest = {},
): Promise<SchedulePlan> {
  const response = await apiFetch(`/schedule/apply`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: planBody(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to apply schedule"));
  }
  return response.json();
}

export async function undoSchedule(): Promise<SchedulePlan> {
  const response = await apiFetch(`/schedule/undo`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to undo schedule"));
  }
  return response.json();
}

export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const response = await apiFetch(`/schedule/settings`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load schedule settings"));
  }
  return response.json();
}

export async function updateScheduleSettings(
  data: Partial<ScheduleSettings>,
): Promise<ScheduleSettings> {
  const response = await apiFetch(`/schedule/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to save schedule settings"));
  }
  return response.json();
}

export async function getRank(): Promise<RankedTask[]> {
  // The API ranks "today" in the saved Working hours timezone, falling back to
  // this timezone so a new account ranks in the same day it schedules in.
  const params = new URLSearchParams({ timezone: browserTimezone() });
  const response = await apiFetch(`/schedule/rank?${params}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load rank"));
  }
  const body = await response.json();
  return body.items ?? body ?? [];
}

export async function getCapacity(from: Date, to: Date): Promise<DayCapacity[]> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: browserTimezone(),
  });
  const response = await apiFetch(`/schedule/capacity?${params}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load capacity"));
  }
  const body = await response.json();
  return body.days ?? body;
}

export async function pinTask(taskId: string, locked: boolean): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/schedule-lock`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locked }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to pin task"));
  }
  const body = await response.json();
  return body.task ?? body;
}

export async function pinBlock(blockId: string, locked: boolean): Promise<ScheduledBlock> {
  const response = await apiFetch(`/blocks/${blockId}/lock`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locked }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to pin block"));
  }
  const body = await response.json();
  return body.block ?? body;
}

export interface AddBlockPayload {
  start: string;
  end?: string;
  durationMinutes?: number;
  /** Drop the task's other blocks so this becomes its only one. */
  replace?: boolean;
}

/** Pins a manual block for a one-off task. */
export async function addTaskBlock(
  taskId: string,
  data: AddBlockPayload,
): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/blocks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to schedule task"));
  }
  const body = await response.json();
  return body.task ?? body;
}

/** Removes every block so the task leaves the calendar. */
export async function clearTaskBlocks(taskId: string): Promise<Task> {
  const response = await apiFetch(`/tasks/${taskId}/blocks`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to unschedule task"));
  }
  const body = await response.json();
  return body.task ?? body;
}

export async function moveBlock(
  blockId: string,
  data: { start: string; end?: string },
): Promise<ScheduledBlock> {
  const response = await apiFetch(`/blocks/${blockId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to move block"));
  }
  const body = await response.json();
  return body.block ?? body;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const response = await apiFetch(`/blocks/${blockId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to remove block"));
  }
}

export async function getToday(date?: string, timezone?: string): Promise<TodayResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (timezone) params.set("timezone", timezone);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/today${suffix}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load today"));
  }
  return response.json();
}

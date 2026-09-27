import type { CalendarItem, Task } from "./types";
import { startOfDay } from "./format";
import { taskEntityColor } from "./entityColor";

function dateFromDateInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function latestTaskSchedule(
  task: Task,
): { start: Date; end: Date; blockId?: string } | null {
  let latest: { start: Date; end: Date; blockId?: string } | null = null;
  for (const block of task.blocks ?? []) {
    const start = new Date(block.start);
    const end = new Date(block.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (!latest || end > latest.end) latest = { start, end, blockId: block.id };
  }
  if (task.scheduledOn) {
    const start = new Date(task.scheduledOn);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + Math.max(task.duration, 0) * 60_000);
      if (!latest || start >= latest.end) latest = { start, end, blockId: latest?.blockId };
    }
  }
  return latest;
}

export function isTaskOverdue(task: Task, now = new Date()): boolean {
  if (task.completedAt || task.kind === "inbox" || task.kind === "reminder") return false;
  if (!task.deadline) return false;
  const today = startOfDay(now);
  const deadline = startOfDay(dateFromDateInput(task.deadline));
  return deadline < today;
}

export function isAgendaOverdue(task: Task, now = new Date()): boolean {
  if (!isTaskOverdue(task, now)) return false;
  const today = startOfDay(now);
  const schedule = latestTaskSchedule(task);
  if (schedule && startOfDay(schedule.end) >= today) return false;
  return true;
}

export function overdueAgendaTasks(tasks: Task[], now = new Date()): Task[] {
  return tasks
    .filter((task) => isAgendaOverdue(task, now))
    .sort((a, b) => {
      const aTime = latestTaskSchedule(a)?.end.getTime() ?? 0;
      const bTime = latestTaskSchedule(b)?.end.getTime() ?? 0;
      return aTime - bTime;
    });
}

export function taskToCalendarItem(task: Task): CalendarItem {
  const schedule = latestTaskSchedule(task);
  const start = schedule?.start ?? (task.deadline ? dateFromDateInput(task.deadline) : new Date());
  const minutes = Math.max(task.duration || 0, 30);
  const end = schedule?.end ?? new Date(start.getTime() + minutes * 60_000);
  return {
    id: schedule?.blockId ?? `overdue:${task.id}`,
    kind: "task",
    title: task.name,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: !schedule,
    color: taskEntityColor(task),
    blockId: schedule?.blockId,
    chunkIndex: 0,
    chunkCount: 1,
    taskId: task.id,
    completedAt: task.completedAt,
    task,
  };
}

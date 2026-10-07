import { dateInZone, isOverdue, todayInZone } from "@timely/contract/workStatus";
import type { CalendarItem, Task } from "@/app/_types/types";
import { dateFromDateInput } from "@/app/utils/calendar";
import { taskEntityColor } from "@/app/utils/entityColor";

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

/**
 * Overdue work that would otherwise vanish from a forward-looking agenda.
 * "Today" is the date in the Working hours timezone (`timeZone`), as on the
 * server; undefined means the device zone.
 */
export function isAgendaOverdue(task: Task, timeZone?: string | null, now = new Date()): boolean {
  const today = todayInZone(timeZone, now);
  if (!isOverdue(task, today)) return false;
  const schedule = latestTaskSchedule(task);
  if (schedule && dateInZone(schedule.end, timeZone) >= today) return false;
  return true;
}

export function overdueAgendaTasks(tasks: Task[], timeZone?: string | null, now = new Date()): Task[] {
  return tasks
    .filter((task) => isAgendaOverdue(task, timeZone, now))
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

import type { Task } from "@/app/_types/types";
import { dateFromDateInput } from "@/app/utils/calendar";

/**
 * One place that answers "when is this task happening?" so Kanban, Gantt,
 * Dashboard, saved views and Today agree. A task can carry time in several
 * shapes (deadline, engine/manual blocks, a bare scheduledOn, a recurrence
 * anchor, a start date) and each surface used to pick its own subset.
 */

export type TaskDateSource = "deadline" | "block" | "scheduledOn" | "recurrence" | "startDate";

export interface TaskDatePoint {
  date: Date;
  source: TaskDateSource;
  /** Only for block-backed points. */
  end?: Date;
  blockId?: string;
}

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** All reserved time on the task, earliest first. Includes a bare scheduledOn
 * (no block row) so reminders and legacy rows still count. */
export function taskTimeSlots(task: Task): { start: Date; end: Date; blockId?: string }[] {
  const slots: { start: Date; end: Date; blockId?: string }[] = [];
  for (const block of task.blocks ?? []) {
    const start = parse(block.start);
    const end = parse(block.end);
    if (!start || !end) continue;
    slots.push({ start, end, blockId: block.id });
  }
  if (slots.length === 0) {
    const start = parse(task.scheduledOn);
    if (start) {
      const end = new Date(start.getTime() + Math.max(task.duration ?? 0, 0) * 60_000);
      slots.push({ start, end });
    }
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/** The block the user will work next: the first one that has not ended yet,
 * or the last one if everything is already in the past. */
export function nextTaskSlot(
  task: Task,
  now = new Date(),
): { start: Date; end: Date; blockId?: string } | null {
  const slots = taskTimeSlots(task);
  if (slots.length === 0) return null;
  return slots.find((slot) => slot.end.getTime() >= now.getTime()) ?? slots[slots.length - 1];
}

export function taskDeadlineDate(task: Task): Date | null {
  if (!task.deadline) return null;
  const date = dateFromDateInput(task.deadline);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The date to show on a card or use for "upcoming" logic when a task has no
 * explicit deadline. Preference: deadline → next block → recurrence anchor →
 * start date. Returns null for genuinely undated work.
 */
export function taskNextDate(task: Task, now = new Date()): TaskDatePoint | null {
  const deadline = taskDeadlineDate(task);
  if (deadline) return { date: deadline, source: "deadline" };

  const slot = nextTaskSlot(task, now);
  if (slot) {
    return {
      date: slot.start,
      end: slot.end,
      blockId: slot.blockId,
      source: slot.blockId ? "block" : "scheduledOn",
    };
  }

  const anchor = parse(task.recurrence?.dtstart);
  if (anchor) return { date: anchor, source: "recurrence" };

  const start = parse(task.startDate);
  if (start) return { date: start, source: "startDate" };

  return null;
}

/** Whichever comes first: the deadline or the next reserved block. Used for
 * "what is due or planned in the next N days" so scheduled-only work counts. */
export function taskUpcomingDate(task: Task, now = new Date()): TaskDatePoint | null {
  const candidates: TaskDatePoint[] = [];
  const deadline = taskDeadlineDate(task);
  if (deadline) candidates.push({ date: deadline, source: "deadline" });
  const slot = nextTaskSlot(task, now);
  if (slot) {
    candidates.push({
      date: slot.start,
      end: slot.end,
      blockId: slot.blockId,
      source: slot.blockId ? "block" : "scheduledOn",
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return candidates[0];
}

/** True when the task has a deadline or any reserved block / ping time. The
 * predicate behind the "My Deadlines" saved view. */
export function taskHasDate(task: Task): boolean {
  return Boolean(task.deadline) || taskTimeSlots(task).length > 0 || Boolean(task.recurrence);
}

/** Timeline span for Gantt-style rendering. Undated work returns null rather
 * than a fake bar built from created/updated timestamps. */
export function taskTimelineSpan(task: Task): { start: Date; end: Date } | null {
  const slots = taskTimeSlots(task);
  const start =
    parse(task.startDate) ??
    slots[0]?.start ??
    parse(task.recurrence?.dtstart) ??
    null;
  const end =
    taskDeadlineDate(task) ??
    (slots.length > 0 ? slots[slots.length - 1].end : null) ??
    null;

  if (!start && !end) return null;
  const resolvedStart = start ?? end!;
  const resolvedEnd = end ?? start!;
  return {
    start: resolvedStart,
    end: resolvedEnd < resolvedStart ? resolvedStart : resolvedEnd,
  };
}

export function formatTaskDatePoint(point: TaskDatePoint | null): string {
  if (!point) return "No date";
  const day = point.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (point.source === "deadline" || point.source === "startDate") return day;
  const time = point.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

export function taskDateSourceLabel(source: TaskDateSource): string {
  switch (source) {
    case "deadline":
      return "Deadline";
    case "block":
      return "Next block";
    case "scheduledOn":
      return "Scheduled";
    case "recurrence":
      return "Repeats from";
    case "startDate":
      return "Starts";
  }
}

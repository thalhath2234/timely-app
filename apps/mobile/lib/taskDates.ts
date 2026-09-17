import type { Task } from "./types";

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

export function taskDeadlineDate(task: Task): Date | null {
  return parse(task.deadline);
}

export function taskHasDate(task: Task): boolean {
  return Boolean(task.deadline) || taskTimeSlots(task).length > 0 || Boolean(task.recurrence);
}

import type { CalendarItem } from "./types";
import { isSameDay } from "./format";

const GAP_MS = 5 * 60_000 + 1_000;

export function mergeCalendarItems(items: CalendarItem[]): CalendarItem[] {
  const timedTasks: CalendarItem[] = [];
  const rest: CalendarItem[] = [];

  for (const item of items) {
    if (!item.allDay && item.kind === "task" && (item.taskId || item.task?.id)) {
      timedTasks.push(item);
    } else {
      rest.push(item);
    }
  }

  const groups = new Map<string, CalendarItem[]>();
  for (const item of timedTasks) {
    const key = item.taskId ?? item.task?.id ?? item.id;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const merged: CalendarItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.start.localeCompare(b.start));
    let current = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      const next = sorted[i];
      const gap = new Date(next.start).getTime() - new Date(current.end).getTime();
      if (isSameDay(new Date(current.start), new Date(next.start)) && gap <= GAP_MS) {
        current = { ...current, end: next.end, chunkIndex: 0, chunkCount: 1 };
      } else {
        merged.push({ ...current, chunkIndex: 0, chunkCount: 1 });
        current = next;
      }
    }
    merged.push({ ...current, chunkIndex: 0, chunkCount: 1 });
  }

  return [...rest, ...merged].sort((a, b) => a.start.localeCompare(b.start));
}

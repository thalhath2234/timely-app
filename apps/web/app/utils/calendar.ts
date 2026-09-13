import type { CSSProperties } from "react";
import type {
  BlockSource,
  CalendarEventEntity,
  CalendarItem,
  CalendarItemKind,
  CalendarView,
  Task,
} from "@/app/_types/types";

/** Pixel height of one hour row in the day/week time grid. */
export const HOUR_HEIGHT = 56;

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_EVENT_MINUTES = 30;
/** All-day items are drawn as a short strip at the top of the day column. */
const ALL_DAY_STRIP_HOURS = 0.5;

/**
 * One block drawn on the calendar. It can come from a task block, a standalone
 * event, or an expanded occurrence of a recurring task or event; the views do
 * not care which, the dialogs do.
 */
export type CalendarEvent = {
  id: string;
  kind: CalendarItemKind;
  title: string;
  start: Date;
  end: Date;
  /** Fractional hours from midnight, e.g. 9.5 for 09:30. */
  startHour: number;
  endHour: number;
  durationMinutes: number;
  allDay: boolean;
  color: string | null;
  statusName: string | null;
  /** Secondary line for list-style views. */
  subtitle: string | null;
  task?: Task;
  event?: CalendarEventEntity;
  /** Task blocks */
  blockId?: string;
  source?: BlockSource;
  chunkIndex: number;
  chunkCount: number;
  /** Occurrences of a series */
  seriesId?: string;
  originalStart?: Date;
  moved: boolean;
  completedAt: Date | null;
  item: CalendarItem;
  reminder: boolean;
};

export function isTaskKind(kind: CalendarItemKind) {
  return kind === "task" || kind === "taskOccurrence";
}

export function isOccurrenceKind(kind: CalendarItemKind) {
  return kind === "taskOccurrence" || kind === "eventOccurrence";
}

/** Maps the unified GET /calendar payload onto renderable blocks. */
export function toCalendarEvents(items: CalendarItem[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const item of items) {
    const start = new Date(item.start);
    const end = new Date(item.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    const rawMinutes = Math.max(
      Math.round((end.getTime() - start.getTime()) / 60_000),
      item.allDay ? MINUTES_PER_DAY : 0,
    );
    const reminder = Boolean(item.reminder || (isTaskKind(item.kind) && (item.task?.duration ?? 1) <= 0));
    const durationMinutes = reminder
      ? 20
      : rawMinutes || DEFAULT_EVENT_MINUTES;
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const task = item.task;

    const isTask = isTaskKind(item.kind);
    const subtitleParts = isTask
      ? [task?.project?.title ?? task?.workspace?.name ?? null]
      : ["Event"];
    if (reminder) subtitleParts.unshift("Reminder");
    if (item.kind === "task" && item.chunkCount > 1) {
      subtitleParts.push(`Part ${item.chunkIndex + 1} of ${item.chunkCount}`);
    }
    if (isOccurrenceKind(item.kind)) subtitleParts.push("Repeats");

    events.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      start,
      end,
      startHour: item.allDay ? 0 : startMinutes / 60,
      // Blocks are drawn inside a single day column, so clamp overnight spill.
      endHour: item.allDay
        ? ALL_DAY_STRIP_HOURS
        : Math.min(startMinutes + durationMinutes, MINUTES_PER_DAY) / 60,
      durationMinutes,
      allDay: item.allDay,
      color: item.color ?? (isTask ? task?.status?.color ?? null : null),
      statusName: isTask ? task?.status?.name ?? null : null,
      subtitle: subtitleParts.filter(Boolean).join(" · ") || null,
      task,
      event: item.event,
      blockId: item.blockId,
      source: item.source,
      chunkIndex: item.chunkIndex,
      chunkCount: item.chunkCount,
      seriesId: item.seriesId,
      originalStart: item.originalStart ? new Date(item.originalStart) : undefined,
      moved: Boolean(item.moved),
      completedAt: item.completedAt ? new Date(item.completedAt) : null,
      item,
      reminder,
    });
  }

  return mergeAdjacentTaskBlocks(
    events.sort((a, b) => a.start.getTime() - b.start.getTime()),
  );
}

/**
 * Auto-schedule writes one row per chunk and inserts a 5-minute rest between
 * them. Those still count as one sitting on the calendar.
 */
const ADJACENT_GAP_MS = 5 * 60_000 + 1_000;

function taskMergeId(event: CalendarEvent): string | undefined {
  if (event.allDay || event.kind !== "task" || event.reminder) return undefined;
  return event.task?.id ?? event.item.taskId ?? `title:${event.title}`;
}

/** Same-task chunks with no real interruption draw as one bar. */
export function mergeAdjacentTaskBlocks(events: CalendarEvent[]): CalendarEvent[] {
  const keyed = new Map<string, CalendarEvent[]>();
  const rest: CalendarEvent[] = [];

  for (const event of events) {
    const taskId = taskMergeId(event);
    if (!taskId) {
      rest.push(event);
      continue;
    }
    const group = keyed.get(taskId);
    if (group) group.push(event);
    else keyed.set(taskId, [event]);
  }

  const merged: CalendarEvent[] = [];
  for (const group of keyed.values()) {
    const sorted = [...group].sort((a, b) => a.start.getTime() - b.start.getTime());
    let current = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      const next = sorted[i];
      const gap = next.start.getTime() - current.end.getTime();
      if (isSameDay(current.start, next.start) && gap <= ADJACENT_GAP_MS) {
        current = spanEvent(current, next.end);
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
  }

  return [...rest, ...merged].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function spanEvent(event: CalendarEvent, end: Date): CalendarEvent {
  const durationMinutes = Math.max(
    Math.round((end.getTime() - event.start.getTime()) / 60_000),
    0,
  );
  const startMinutes = event.start.getHours() * 60 + event.start.getMinutes();
  const subtitle = event.subtitle
    ?.split(" · ")
    .filter((part) => !/^Part \d+ of \d+$/.test(part))
    .join(" · ") || null;

  return {
    ...event,
    end,
    durationMinutes,
    endHour: Math.min(startMinutes + durationMinutes, MINUTES_PER_DAY) / 60,
    chunkIndex: 0,
    chunkCount: 1,
    subtitle,
  };
}

/**
 * The window the calendar needs for a given view. Month pads to whole weeks,
 * agenda looks a week ahead; a small margin on each side keeps items that
 * straddle midnight.
 */
export function viewRange(date: Date, view: CalendarView): { from: Date; to: Date } {
  if (view === "month") {
    const { days } = monthGrid(date);
    return { from: days[0], to: addDays(days[days.length - 1], 1) };
  }
  if (view === "day") {
    const from = startOfDay(date);
    return { from, to: addDays(from, 1) };
  }
  if (view === "agenda") {
    const from = startOfDay(date);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfWeek(date);
  return { from, to: addDays(from, 7) };
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sunday-first, matching how the calendar has always been laid out. */
export function startOfWeek(date: Date): Date {
  return addDays(date, -date.getDay());
}

export function weekDays(date: Date): Date[] {
  const first = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * Leading/trailing days from adjacent months pad the grid to whole weeks, so
 * the row count varies between 4 and 6 depending on the month.
 */
export function monthGrid(date: Date): { days: Date[]; rows: number } {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const leading = firstOfMonth.getDay();
  const daysInMonth = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  const rows = Math.ceil((leading + daysInMonth) / 7);
  const firstCell = addDays(firstOfMonth, -leading);

  return {
    days: Array.from({ length: rows * 7 }, (_, i) => addDays(firstCell, i)),
    rows,
  };
}

export function eventsForDay(
  events: CalendarEvent[],
  day: Date,
): CalendarEvent[] {
  return events.filter((event) => isSameDay(event.start, day));
}

export type PositionedEvent = {
  event: CalendarEvent;
  /** Column index within a set of overlapping events. */
  lane: number;
  /** How many columns that overlapping set was split into. */
  lanes: number;
};

/**
 * Splits overlapping events into side-by-side columns. Events are grouped into
 * clusters of transitively overlapping blocks; every event in a cluster gets
 * the same column count so their widths line up.
 */
export function layoutDayEvents(events: CalendarEvent[]): PositionedEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.startHour - b.startHour || b.endHour - a.endHour,
  );

  const positioned: PositionedEvent[] = [];
  let cluster: PositionedEvent[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const closeCluster = () => {
    for (const item of cluster) item.lanes = laneEnds.length || 1;
    cluster = [];
    laneEnds = [];
  };

  for (const event of sorted) {
    if (event.startHour >= clusterEnd) {
      closeCluster();
      clusterEnd = Number.NEGATIVE_INFINITY;
    }

    let lane = laneEnds.findIndex((end) => end <= event.startHour);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = event.endHour;
    clusterEnd = Math.max(clusterEnd, event.endHour);

    const item: PositionedEvent = { event, lane, lanes: 1 };
    cluster.push(item);
    positioned.push(item);
  }

  closeCluster();
  return positioned;
}

/**
 * Status colors arrive from the API as hex strings; fall back to the theme's
 * primary when a task has no status.
 */
export function eventStyle(color?: string | null): CSSProperties {
  if (!color) {
    return {
      backgroundColor: "color-mix(in oklab, var(--primary) 32%, var(--card))",
      borderColor: "color-mix(in oklab, var(--primary) 50%, var(--border))",
    };
  }

  return {
    backgroundColor: `color-mix(in oklab, ${color} 38%, var(--card))`,
    borderColor: `color-mix(in oklab, ${color} 55%, var(--border))`,
  };
}

export function swatchColor(color?: string | null): string {
  return color ?? "var(--primary)";
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Distinct statuses (and a single "Events" swatch) for the legend row. */
export function eventLegend(
  events: CalendarEvent[],
): { label: string; color: string | null }[] {
  const seen = new Map<string, { label: string; color: string | null }>();

  for (const event of events) {
    const label = isTaskKind(event.kind)
      ? event.statusName ?? "No status"
      : "Events";
    if (!seen.has(label)) seen.set(label, { label, color: event.color });
  }

  return Array.from(seen.values());
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shiftDate(
  date: Date,
  view: CalendarView,
  direction: 1 | -1,
): Date {
  const next = new Date(date);

  if (view === "month") next.setMonth(next.getMonth() + direction);
  else if (view === "day") next.setDate(next.getDate() + direction);
  else next.setDate(next.getDate() + 7 * direction);

  return next;
}

/** Local calendar day as `YYYY-MM-DD`. */
export function localDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** First ten characters of a date-only or RFC3339 value. */
export function dateOnly(value?: string | Date | null): string {
  if (!value) return "";
  if (value instanceof Date) return localDateStamp(value);
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function addCalendarDays(stamp: string, days: number): string {
  const [year, month, day] = stamp.split("-").map(Number);
  return localDateStamp(new Date(year, month - 1, day + days));
}

/** Value for date inputs / pickers (`YYYY-MM-DD`) from an ISO / date string. */
export function toDateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const fromStamp = dateOnly(value);
  if (fromStamp) return fromStamp;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Value for datetime pickers (`YYYY-MM-DDTHH:mm`) from an ISO / timestamptz string. */
export function toDatetimeLocalValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Turns a datetime-local value into an ISO string the API can store. */
export function fromDatetimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/** Clock value (`HH:mm`) from an ISO timestamp, datetime-local string, or Date. */
export function toTimeInputValue(value?: string | Date | null): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [hours, minutes] = value.trim().split(":");
    return `${hours.padStart(2, "0")}:${minutes}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Local calendar day from `YYYY-MM-DD`, falling back to today. */
export function dateFromDateInput(value?: string | null): Date {
  if (!value) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** Keep the calendar day, replace the clock. `hhmm` is `HH:mm`. */
export function nextRoundHour(from = new Date()): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

export function applyClockToDate(day: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
}

/** Build a slot at `hour:00` on the given day (local time). */
export function slotAt(day: Date, hour: number, minute = 0): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

export function headerLabel(date: Date, view: CalendarView): string {
  if (view === "day") {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    });
  }

  if (view === "month") {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  const start = view === "week" ? startOfWeek(date) : startOfDay(date);
  const end = addDays(start, 6);
  const startLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const endLabel =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}, ${end.getFullYear()}`
      : end.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

  return `${startLabel} – ${endLabel}`;
}

import type { CalendarItem, WeekdayKey, WorkingHours } from "./types";

const WEEKDAYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SNAP_MINUTES = 15;
const DEFAULT_WINDOW = { start: "09:00", end: "17:00" };
const DEFAULT_HOURS: WorkingHours = {
  timezone: "",
  days: {
    mon: [DEFAULT_WINDOW],
    tue: [DEFAULT_WINDOW],
    wed: [DEFAULT_WINDOW],
    thu: [DEFAULT_WINDOW],
    fri: [DEFAULT_WINDOW],
    sat: [],
    sun: [],
  },
};

export type BusyInterval = { start: string; end: string; allDay?: boolean; reminder?: boolean };

type CacheEntry = { signature: string; at: number };
let cache: CacheEntry | null = null;

function hoursEmpty(hours?: WorkingHours | null) {
  return !hours || (!hours.timezone && Object.keys(hours.days ?? {}).length === 0);
}

function parseClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
}

function snapUp(date: Date, minutes = SNAP_MINUTES) {
  const step = minutes * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

function mergeBusy(items: BusyInterval[], now: Date) {
  const ranges = items
    .filter((item) => !item.allDay && !item.reminder)
    .map((item) => ({ start: new Date(item.start).getTime(), end: new Date(item.end).getTime() }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > now.getTime())
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const item of ranges) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged;
}

function signature(now: Date, duration: number, hours: WorkingHours, busy: BusyInterval[]) {
  const minute = Math.floor(now.getTime() / 60_000);
  const hoursKey = JSON.stringify(hours.days);
  const busyKey = busy.map((item) => `${item.start}:${item.end}`).join("|");
  return `${minute}|${duration}|${hoursKey}|${busyKey}`;
}

export function findNextFreeSlot({
  now = new Date(),
  durationMinutes = 30,
  hours,
  busy,
  lookAheadDays = 21,
}: {
  now?: Date;
  durationMinutes?: number;
  hours?: WorkingHours | null;
  busy: BusyInterval[];
  lookAheadDays?: number;
}): Date {
  const duration = Math.max(SNAP_MINUTES, durationMinutes || 30);
  const template = hoursEmpty(hours) ? DEFAULT_HOURS : hours!;
  const key = signature(now, duration, template, busy);
  if (cache && cache.signature === key) return new Date(cache.at);

  const occupied = mergeBusy(busy, now);
  const need = duration * 60_000;
  let found = snapUp(now);

  outer: for (let offset = 0; offset < lookAheadDays; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const windows = template.days[WEEKDAYS[day.getDay()]] ?? [];
    for (const window of windows) {
      const startMin = parseClock(window.start);
      const endMin = parseClock(window.end);
      if (startMin == null || endMin == null || endMin <= startMin) continue;
      const windowEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(endMin / 60), endMin % 60);
      let cursor = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(startMin / 60), startMin % 60);
      if (cursor < now) cursor = now;
      cursor = snapUp(cursor);

      while (cursor.getTime() + need <= windowEnd.getTime()) {
        const end = cursor.getTime() + need;
        const hit = occupied.find((item) => cursor.getTime() < item.end && end > item.start);
        if (!hit) {
          found = cursor;
          break outer;
        }
        cursor = snapUp(new Date(hit.end));
      }
    }
  }

  cache = { signature: key, at: found.getTime() };
  return found;
}

export function calendarBusy(items: CalendarItem[]): BusyInterval[] {
  return items.map((item) => ({
    start: item.start,
    end: item.end,
    allDay: item.allDay,
    reminder: item.reminder,
  }));
}

/**
 * Pure data for the week-in-review film: what one week of the user's own
 * data looks like as numbers, a grid and a list. Safe to import from the
 * Today page, the Player and the render script; nothing here fetches.
 */
import type { CalendarItem } from "@timely/contract/calendar";
import { calendarItemDone } from "@timely/contract/calendar";
import type { Doc } from "@timely/contract/documents";
import type { FocusSession, Task } from "@timely/contract/entities";
import type { Sheet } from "@timely/contract/sheet";

export type ReviewBlock = {
  title: string;
  /** Column, 0 = the first day of the week. */
  day: number;
  /** Start as hours since midnight, e.g. 9.5. */
  start: number;
  hours: number;
  color: string;
  done: boolean;
  /** A calendar event rather than a task block. */
  event: boolean;
};

export type ReviewDone = {
  title: string;
  day: number;
  color: string;
};

export type WeekReview = {
  /** "Oct 12 – 18". */
  label: string;
  /** Short labels for the seven columns, in order. */
  days: string[];
  /** Column of today; 7 once the week is over. */
  today: number;
  /** First and last hour shown on the grid. */
  from: number;
  to: number;
  /** Every timed entry of the week, in time order. */
  blocks: ReviewBlock[];
  /** Tasks completed this week, in the order they were finished. */
  done: ReviewDone[];
  /** Tasks completed the week before, for the comparison. */
  doneBefore: number;
  focusMinutes: number;
  focusSessions: number;
  /** Minutes of task blocks on the calendar this week. */
  plannedMinutes: number;
  /** Titles of docs and sheets edited this week, newest first. */
  docs: string[];
  sheets: string[];
  /** Work still open at the end of the week. */
  open: number;
  /** Open tasks to show as "Up next" when few were finished: the ones scheduled soonest first. */
  next: ReviewNext[];
};

export type ReviewNext = { title: string; color: string };

const PALETTE = ["#30a66d", "#ffb224", "#0090ff", "#e93d82", "#6e56cf", "#00a2c7", "#f76808", "#b8b7ff"];
const DAY = 24 * 60 * 60 * 1000;
const MAX_LISTED = 6;

function dayStart(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sunday-first, as the calendar lays weeks out. */
export function reviewWeek(now: Date) {
  const start = dayStart(now);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function hashColor(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function inRange(iso: string | null | undefined, start: Date, end: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

function dayIndex(iso: string, start: Date) {
  return Math.floor((dayStart(new Date(iso)).getTime() - start.getTime()) / DAY);
}

function shortDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Builds the review for the week that holds `now`, in the browser's zone. */
export function reviewFromData({
  now,
  tasks,
  items,
  sessions,
  docs,
  sheets,
}: {
  now: Date;
  tasks: Task[];
  items: CalendarItem[];
  sessions: FocusSession[];
  docs: Doc[];
  sheets: Sheet[];
}): WeekReview {
  const { start, end } = reviewWeek(now);
  const before = new Date(start);
  before.setDate(before.getDate() - 7);
  const last = new Date(end.getTime() - DAY);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY).toLocaleDateString(undefined, { weekday: "short" }));
  const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;

  const blocks: ReviewBlock[] = items
    .filter((item) => !item.allDay && !item.reminder && inRange(item.start, start, end))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((item) => {
      const s = new Date(item.start);
      const e = new Date(item.end);
      const event = item.kind === "event" || item.kind === "eventOccurrence";
      return {
        title: item.title,
        day: dayIndex(item.start, start),
        start: hourOf(s),
        hours: Math.max(0.25, (e.getTime() - s.getTime()) / (60 * 60 * 1000)),
        color: item.color ?? item.task?.project?.color ?? hashColor(item.title),
        done: calendarItemDone(item),
        event,
      };
    })
    .filter((block) => block.day >= 0 && block.day < 7);

  const from = blocks.length ? Math.max(0, Math.floor(Math.min(...blocks.map((b) => b.start))) - 1) : 8;
  const to = blocks.length ? Math.min(24, Math.ceil(Math.max(...blocks.map((b) => (b.start + b.hours === 0 ? 24 : b.start + b.hours)))) + 1) : 18;

  const done: ReviewDone[] = tasks
    .filter((task) => task.kind === "task" && inRange(task.completedAt, start, end))
    .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
    .map((task) => ({ title: task.name, day: dayIndex(task.completedAt as string, start), color: task.project?.color ?? hashColor(task.name) }));
  const doneBefore = tasks.filter((task) => task.kind === "task" && inRange(task.completedAt, before, start)).length;
  const openTasks = tasks.filter((task) => task.kind === "task" && !task.completedAt);
  const open = openTasks.length;
  const next: ReviewNext[] = [...openTasks]
    .sort((a, b) => (a.scheduledOn ?? "~").localeCompare(b.scheduledOn ?? "~") || a.name.localeCompare(b.name))
    .slice(0, MAX_LISTED)
    .map((task) => ({ title: task.name, color: task.project?.color ?? hashColor(task.name) }));

  const week = sessions.filter((session) => inRange(session.endedAt, start, end));
  const focusMinutes = week.reduce((sum, session) => sum + Math.max(0, session.minutes), 0);
  const plannedMinutes = Math.round(blocks.filter((block) => !block.event).reduce((sum, block) => sum + block.hours * 60, 0));

  const touched = <T extends { title: string; updatedAt: string; archivedAt: string | null }>(rows: T[]) =>
    rows
      .filter((row) => !row.archivedAt && inRange(row.updatedAt, start, end))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LISTED)
      .map((row) => row.title || "Untitled");

  return {
    label: `${shortDate(start)} – ${shortDate(last)}`,
    days,
    today: Math.min(7, Math.max(0, Math.floor((dayStart(now).getTime() - start.getTime()) / DAY))),
    from: Math.min(from, Math.max(0, to - 8)),
    to: Math.max(to, Math.min(24, from + 8)),
    blocks,
    done,
    doneBefore,
    focusMinutes,
    focusSessions: week.length,
    plannedMinutes,
    docs: touched(docs.filter((doc) => !doc.isTemplate)),
    sheets: touched(sheets),
    open,
    next,
  };
}

/** "timely-week-2026-10-12" for the week that holds `now`; the player adds the extension of the format it can encode. */
export function reviewFileName(now: Date) {
  const { start } = reviewWeek(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `timely-week-${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

/** "3h 20m" or "45m". */
export function reviewHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A week as Studio shows it (`make film-studio`, composition WeekInReview). */
export const SAMPLE_REVIEW: WeekReview = {
  label: "Oct 12 – 18",
  days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  today: 5,
  from: 8,
  to: 19,
  blocks: [
    { title: "Weekly planning", day: 1, start: 9, hours: 0.5, color: "#0090ff", done: true, event: true },
    { title: "Design the homepage", day: 1, start: 10, hours: 3, color: "#ffb224", done: true, event: false },
    { title: "Fix flaky test on CI", day: 2, start: 9.5, hours: 1.5, color: "#30a66d", done: true, event: false },
    { title: "Audit current pages", day: 2, start: 13, hours: 2, color: "#ffb224", done: true, event: false },
    { title: "Spanish lesson", day: 2, start: 18, hours: 1, color: "#e93d82", done: true, event: true },
    { title: "Write the launch brief", day: 3, start: 10, hours: 2, color: "#6e56cf", done: true, event: false },
    { title: "Pick a CMS", day: 3, start: 14, hours: 1.5, color: "#ffb224", done: false, event: false },
    { title: "Hero illustration", day: 4, start: 9, hours: 2.5, color: "#ffb224", done: true, event: false },
    { title: "Measure the floor", day: 4, start: 16, hours: 1, color: "#00a2c7", done: true, event: false },
    { title: "Record the demo", day: 5, start: 10, hours: 1, color: "#0090ff", done: false, event: false },
    { title: "Set up redirects", day: 5, start: 14, hours: 1.5, color: "#30a66d", done: false, event: false },
  ],
  done: [
    { title: "Design the homepage", day: 1, color: "#ffb224" },
    { title: "Fix flaky test on CI", day: 2, color: "#30a66d" },
    { title: "Audit current pages", day: 2, color: "#ffb224" },
    { title: "Write the launch brief", day: 3, color: "#6e56cf" },
    { title: "Hero illustration", day: 4, color: "#ffb224" },
    { title: "Measure the floor", day: 4, color: "#00a2c7" },
    { title: "Renew passport", day: 4, color: "#b8b7ff" },
  ],
  doneBefore: 4,
  focusMinutes: 585,
  focusSessions: 9,
  plannedMinutes: 1050,
  docs: ["Website launch brief", "Weekly review: 12 Oct", "Reading list"],
  sheets: ["Launch budget", "Expenses: October"],
  open: 14,
  next: [
    { title: "Pick a CMS", color: "#ffb224" },
    { title: "Record the demo", color: "#0090ff" },
    { title: "Set up redirects", color: "#30a66d" },
  ],
};

/**
 * Work status on the client: the current date in the Working hours timezone
 * and the Overdue predicate. The server judges Overdue against that date
 * (`apps/api/internal/features/task/overdue.go`, `today.go`), so clients must
 * not use the device's date unless no timezone is saved.
 */

/** The fields Overdue reads; a full `Task` satisfies it. */
export interface OverdueFields {
  kind?: string | null;
  deadline?: string | null;
  completedAt?: string | null;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  if (formatters.has(timeZone)) return formatters.get(timeZone) ?? null;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Unknown zone: the caller falls back to the device zone, as the server
    // falls back when it cannot load the saved one.
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The calendar date (`YYYY-MM-DD`) of the instant `now` in `timeZone`. An
 * empty or unknown `timeZone` uses the device zone, which is what the server
 * does with the client's zone when no Working hours timezone is saved.
 */
export function dateInZone(now: Date, timeZone?: string | null): string {
  const formatter = timeZone ? formatterFor(timeZone) : null;
  if (formatter) {
    let year = "";
    let month = "";
    let day = "";
    for (const part of formatter.formatToParts(now)) {
      if (part.type === "year") year = part.value;
      else if (part.type === "month") month = part.value;
      else if (part.type === "day") day = part.value;
    }
    if (year && month && day) return `${pad(Number(year), 4)}-${month}-${day}`;
  }
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/**
 * Today's date in the Working hours timezone (`config.workingHours.timezone`),
 * falling back to the device zone when none is saved. Pass the result to
 * `isOverdue` so a list is judged against one date.
 */
export function todayInZone(timeZone?: string | null, now: Date = new Date()): string {
  return dateInZone(now, timeZone);
}

/** `date` (`YYYY-MM-DD`) moved by whole calendar `days`, as a `YYYY-MM-DD` stamp. */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

/**
 * Whole calendar days from `from` to `to` (both `YYYY-MM-DD`): positive when
 * `to` is later. Pure date arithmetic, so a DST change never skews it. Pair it
 * with `todayInZone` so "Yesterday" and "3d overdue" agree with `isOverdue`.
 */
export function daysBetween(from: string, to: string): number {
  const parse = (stamp: string) => {
    const [year, month, day] = stamp.slice(0, 10).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * Open Work whose deadline date is before `today` (`YYYY-MM-DD`). Inbox items,
 * Reminders and completed Work never count; a past Block alone does not make
 * Work Overdue. Mirrors `task.IsOverdue` on the server, which compares the
 * deadline text with the date, so a timestamp deadline counts by its date.
 */
export function isOverdue(task: OverdueFields, today: string): boolean {
  if (task.completedAt || task.kind === "inbox" || task.kind === "reminder") return false;
  if (!task.deadline) return false;
  return task.deadline.slice(0, 10) < today;
}

/** The fields Unscheduled reads; a full `Task` satisfies it. */
export interface UnscheduledFields extends OverdueFields {
  scheduledOn?: string | null;
  blocks?: ReadonlyArray<{ start: string; end: string }> | null;
}

const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * The date (`YYYY-MM-DD`) of a server timestamp in `timeZone`. A value with a
 * zone is an instant; one without (`2026-10-07T09:00`) is wall-clock time in
 * the Working hours timezone, so its own date applies. Null when unparseable.
 */
function timestampDate(value: string, timeZone?: string | null): string | null {
  const text = value.trim().replace(" ", "T");
  const time = text.indexOf("T");
  if (time < 0) return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  if (!OFFSET_SUFFIX.test(text.slice(time + 1))) {
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
  }
  // Postgres writes a bare "+00" offset; Date wants "+00:00".
  const normalized = text.replace(/([+-]\d{2})$/, "$1:00");
  const instant = new Date(normalized);
  return Number.isNaN(instant.getTime()) ? null : dateInZone(instant, timeZone);
}

/**
 * Open Work without a Block on the current date in the Working hours
 * timezone (CONTEXT.md, Unscheduled). A Block on a later or earlier date does
 * not count, and neither does a `scheduledOn` ping that falls today. Inbox
 * items, Reminders and completed Work are never Unscheduled. Mirrors
 * `task.IsUnscheduled` on the server.
 */
export function isUnscheduled(
  task: UnscheduledFields,
  timeZone?: string | null,
  now: Date = new Date(),
): boolean {
  if (task.completedAt || task.kind === "inbox" || task.kind === "reminder") return false;
  const today = dateInZone(now, timeZone);
  for (const block of task.blocks ?? []) {
    const start = timestampDate(block.start, timeZone);
    const end = timestampDate(block.end, timeZone);
    if (start !== null && end !== null && start <= today && end >= today) return false;
  }
  if (task.scheduledOn && timestampDate(task.scheduledOn, timeZone) === today) return false;
  return true;
}

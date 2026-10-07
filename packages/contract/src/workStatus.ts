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

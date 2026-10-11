/**
 * The Inbox screen on both apps: which capture is "Up next" and how long each
 * one has waited. Desktop and phone read the same rules so the two screens
 * always agree on the order and on what counts as stale.
 */

import { dateInZone, daysBetween } from "./workStatus";

/** Captures left this many calendar days or more are shown as stale. */
export const INBOX_STALE_DAYS = 3;

/** The fields the Inbox screen reads; a full `Task` satisfies it. */
export interface InboxItemFields {
  id: string;
  createdAt: string;
}

export interface InboxAge {
  /** Whole calendar days since capture; 0 is today. */
  days: number;
  stale: boolean;
  /** "Today", "Yesterday" or "Waiting 4 days". */
  label: string;
}

/** The calendar day a capture was made. Tasks store `createdAt` as a bare
 * `YYYY-MM-DD` (the server's date), which is already that day; a full
 * timestamp is read in `timeZone`. */
function capturedOn(createdAt: string, timeZone?: string | null): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) return createdAt;
  const created = new Date(createdAt);
  return Number.isNaN(created.getTime()) ? null : dateInZone(created, timeZone);
}

export function inboxAge(createdAt: string, now: Date = new Date(), timeZone?: string | null): InboxAge {
  const day = capturedOn(createdAt, timeZone);
  const days = day ? Math.max(0, daysBetween(day, dateInZone(now, timeZone))) : 0;
  const label = days === 0 ? "Today" : days === 1 ? "Yesterday" : `Waiting ${days} days`;
  return { days, stale: days >= INBOX_STALE_DAYS, label };
}

function createdTime(item: InboxItemFields) {
  const time = new Date(item.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Splits the Inbox into the one capture to decide on now and the rest.
 * Up next is the capture that has waited longest, skipping the ones the
 * person passed over this visit; once every capture was skipped the order
 * starts again from the oldest. The rest come newest first, so a fresh
 * capture shows at the top of the grid. Captures from the same day keep the
 * server's order (oldest first), since `createdAt` carries only the date.
 */
export function inboxQueue<T extends InboxItemFields>(
  items: readonly T[],
  skipped: readonly string[] = [],
): { next: T | null; rest: T[] } {
  if (items.length === 0) return { next: null, rest: [] };
  const oldestFirst = [...items].sort((a, b) => createdTime(a) - createdTime(b));
  const passed = new Set(skipped);
  const next = oldestFirst.find((item) => !passed.has(item.id)) ?? oldestFirst[0];
  const rest = oldestFirst.filter((item) => item !== next).reverse();
  return { next, rest };
}

/** The skip list after passing over `id`; cleared once nothing is left to skip to. */
export function skipInboxItem(items: readonly InboxItemFields[], skipped: readonly string[], id: string): string[] {
  const live = new Set(items.map((item) => item.id));
  const next = [...skipped.filter((other) => live.has(other) && other !== id), id];
  return next.length >= live.size ? [] : next;
}

/** The parts of a smart-suggestions answer for one capture that the Up next card reads. */
export interface InboxSuggestionFields {
  kind?: "task" | "reminder";
  workspaceId?: string;
  priority?: string;
  duration?: number;
  dateRole?: "deadline" | "start" | "reminder";
  date?: string;
  time?: string;
  looksLikeEvent?: boolean;
  severalActions?: boolean;
  notReady?: boolean;
  duplicates?: { id: string; name: string }[];
}

function shortDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function lengthLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

/**
 * One plain line of what smart suggestions would make of a capture ("A 45 min
 * task, deadline Fri, Oct 31, in Personal") and the first note worth a look.
 * Both are empty when the answer had nothing confident to say.
 */
export function inboxSuggestionSummary(
  s: InboxSuggestionFields,
  workspaceName?: string,
): { line: string; note: string } {
  const parts: string[] = [];
  if (s.kind === "reminder") {
    parts.push(
      s.dateRole === "reminder" && s.date
        ? `A reminder for ${shortDate(s.date)}${s.time ? ` at ${s.time}` : ""}`
        : "A reminder",
    );
  } else if (s.kind === "task") {
    parts.push(s.duration && s.duration > 0 ? `A ${lengthLabel(s.duration)} task` : "A task");
    if (s.date && s.dateRole === "deadline") parts.push(`deadline ${shortDate(s.date)}`);
    if (s.date && s.dateRole === "start") parts.push(`starts ${shortDate(s.date)}`);
    if (workspaceName) parts.push(`in ${workspaceName}`);
    if (s.priority) parts.push(`${s.priority.toLowerCase()} priority`);
  }
  const note = s.looksLikeEvent
    ? "It looks like an event at a fixed time."
    : s.severalActions
      ? "It may be more than one task."
      : s.notReady
        ? "It may not be ready to act on yet."
        : s.duplicates?.length
          ? `It might already exist as “${s.duplicates[0].name}”.`
          : "";
  return { line: parts.join(", "), note };
}

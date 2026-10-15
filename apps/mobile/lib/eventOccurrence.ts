/*
 * Helpers for opening and editing one occurrence of a recurring event. The
 * calendar lists a series as one item per date; the detail screen needs the
 * date that was tapped (its `originalStart`) so "This occurrence" and "This and
 * following" act on it instead of on the first date of the series.
 */

type EventItemLike = {
  kind: string;
  eventId?: string | null;
  event?: { id: string } | null;
  originalStart?: string | null;
};

/** The event screen's route; an occurrence carries its original start. */
export function eventHref(item: EventItemLike): string {
  const id = item.eventId ?? item.event?.id ?? "";
  const base = `/(app)/events/${id}`;
  if (item.kind !== "eventOccurrence" || !item.originalStart) return base;
  return `${base}?occurrence=${encodeURIComponent(item.originalStart)}`;
}

/** True when two timestamps name the same instant, whatever their offset. */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  return Number.isFinite(left) && left === right;
}

/**
 * The calendar item the screen was opened for: the occurrence whose original
 * start matches `occurrence`, otherwise the event's own (non-occurrence) item,
 * otherwise any item of the event.
 */
export function findEventItem<T extends EventItemLike>(
  items: T[],
  id: string,
  occurrence: string | null | undefined,
): T | undefined {
  const ofEvent = items.filter((entry) => entry.eventId === id || entry.event?.id === id);
  if (occurrence) {
    const match = ofEvent.find((entry) => sameInstant(entry.originalStart, occurrence));
    if (match) return match;
  }
  return ofEvent.find((entry) => entry.kind !== "eventOccurrence") ?? ofEvent[0];
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** The rule with UNTIL set to one second before `cutoff` ("delete this and following"). */
export function withUntil(rrule: string, cutoff: Date): string {
  const parts = rrule
    .replace(/^RRULE:/, "")
    .split(";")
    .filter((part) => part && !/^(UNTIL|COUNT)=/i.test(part));
  const last = new Date(cutoff.getTime() - 1000);
  const until =
    `${last.getUTCFullYear()}${pad(last.getUTCMonth() + 1)}${pad(last.getUTCDate())}` +
    `T${pad(last.getUTCHours())}${pad(last.getUTCMinutes())}${pad(last.getUTCSeconds())}Z`;
  return [...parts, `UNTIL=${until}`].join(";");
}

/** Keeps the calendar day of `base` but takes hours and minutes from `time`. */
export function withTimeOfDay(base: Date, time: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), time.getHours(), time.getMinutes(), 0, 0);
}

// Every sample date is relative to the moment the sample is built, in the
// viewer's local timezone (the app formats dates with the browser zone and
// parses date-only fields like `deadline` as local days).

export type Clock = ReturnType<typeof makeClock>;

const MINUTE = 60_000;

export function makeClock(now = new Date()) {
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  /** Local date `days` from today at hh:mm. */
  const at = (days: number, hours = 0, minutes = 0) =>
    new Date(today0.getFullYear(), today0.getMonth(), today0.getDate() + days, hours, minutes);

  /** ISO instant `days` from today at local hh:mm. */
  const iso = (days: number, hours = 0, minutes = 0) => at(days, hours, minutes).toISOString();

  /** Local calendar day as YYYY-MM-DD. */
  const ymd = (days = 0) => ymdOf(at(days));

  /** ISO instant `minutes` before now. */
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString();

  /** ISO instant `minutes` before now, but never before local midnight today. */
  const earlierToday = (minutes: number) =>
    new Date(Math.max(today0.getTime() + 5 * MINUTE, now.getTime() - minutes * MINUTE)).toISOString();

  return { now, today0, at, iso, ymd, ago, earlierToday };
}

export function ymdOf(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Go's RFC 3339 form (no milliseconds), used in occurrence ids. */
export function rfc3339(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function addMinutes(isoValue: string, minutes: number) {
  return new Date(new Date(isoValue).getTime() + minutes * MINUTE).toISOString();
}

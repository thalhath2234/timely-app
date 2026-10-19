const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * When an activity entry happened, in the person's Working hours zone (pass
 * `useWorkingHoursZone()`; undefined falls back to the device zone). Recent
 * entries read "just now" or "N min ago". A date-only value (older rows store
 * only the day) is a calendar date, not UTC midnight, so it shows no time.
 */
export function formatActivityTime(value?: string | null, timeZone?: string): string {
  if (!value) return "";
  if (DATE_ONLY.test(value)) {
    const day = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) return value;
    return day.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)} min ago`;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

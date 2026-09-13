export function localDateStamp(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateOnly(value?: string | null) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function addCalendarDays(stamp: string, days: number) {
  const [year, month, day] = stamp.split("-").map(Number);
  return localDateStamp(new Date(year, month - 1, day + days));
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number) {
  const year = d.getFullYear();
  const month = d.getMonth() + n;
  const last = new Date(year, month + 1, 0).getDate();
  return startOfDay(new Date(year, month, Math.min(d.getDate(), last)));
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeRange(startIso: string, endIso: string) {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatMonthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function formatShortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function formatRelativeDay(d: Date) {
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDueDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return formatShortDate(iso);
}

export function isOverdue(iso: string | null | undefined, completedAt?: string | null) {
  if (!iso || completedAt) return false;
  return startOfDay(new Date(iso)).getTime() < startOfDay(new Date()).getTime();
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatShortDate(iso);
}

export function formatDuration(minutes: number) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const PRIORITY_SWATCH = {
  urgent: { label: "Urgent", color: "#ef6b5c" },
  high: { label: "High", color: "#e8b54a" },
  medium: { label: "Medium", color: "#8b7cf7" },
  low: { label: "Low", color: "#9a9aa8" },
} as const;

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  ...PRIORITY_SWATCH,
  Urgent: PRIORITY_SWATCH.urgent,
  High: PRIORITY_SWATCH.high,
  Medium: PRIORITY_SWATCH.medium,
  Low: PRIORITY_SWATCH.low,
  Critical: PRIORITY_SWATCH.urgent,
};

export const PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low"];

export function toDateInputValue(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

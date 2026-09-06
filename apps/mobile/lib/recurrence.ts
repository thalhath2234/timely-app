import type { RecurrenceInput } from "./types";
import { deviceTimezone } from "./format";

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

export interface RecurrenceDraft {
  freq: RecurrenceFreq;
  interval: number;
  byDay: number[];
  monthlyMode: "day" | "weekday";
  byMonthDay: number[];
  byMonth: number[];
  end: RecurrenceEnd;
}

export const LAST_DAY = -1;

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: number) {
  return MONTH_LABELS[month - 1] ?? "";
}

export function monthDayLabel(day: number) {
  if (day === LAST_DAY) return "last";
  const mod100 = day % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
}

function sortDays(days: number[]) {
  return [...new Set(days)].sort((a, b) => {
    if (a === LAST_DAY) return 1;
    if (b === LAST_DAY) return -1;
    return a - b;
  });
}

function sameSet(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort((x, y) => x - y);
  const other = [...b].sort((x, y) => x - y);
  return sorted.every((value, index) => value === other[index]);
}

function listWithAnd(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function weekdayLabel(day: number, long = false) {
  return long ? WEEKDAY_LONG[day] : WEEKDAY_LABELS[day];
}

export function defaultDraft(anchor: Date, freq: RecurrenceFreq = "WEEKLY"): RecurrenceDraft {
  return {
    freq,
    interval: 1,
    byDay: freq === "WEEKLY" ? [anchor.getDay()] : [],
    monthlyMode: "day",
    byMonthDay: freq === "MONTHLY" || freq === "YEARLY" ? [anchor.getDate()] : [],
    byMonth: freq === "YEARLY" ? [anchor.getMonth() + 1] : [],
    end: { type: "never" },
  };
}

export function withFreq(draft: RecurrenceDraft, freq: RecurrenceFreq, anchor: Date): RecurrenceDraft {
  const fresh = defaultDraft(anchor, freq);
  return {
    ...draft,
    freq,
    byDay: fresh.byDay,
    monthlyMode: "day",
    byMonthDay: fresh.byMonthDay,
    byMonth: fresh.byMonth,
  };
}

function nthWeekday(anchor: Date): number {
  const nth = Math.ceil(anchor.getDate() / 7);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const isLast = anchor.getDate() + 7 > lastOfMonth.getDate();
  return isLast && nth >= 4 ? -1 : nth;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function untilValue(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 59);
  return (
    `${endOfDay.getUTCFullYear()}${pad(endOfDay.getUTCMonth() + 1)}${pad(endOfDay.getUTCDate())}` +
    `T${pad(endOfDay.getUTCHours())}${pad(endOfDay.getUTCMinutes())}${pad(endOfDay.getUTCSeconds())}Z`
  );
}

export function draftToRRule(draft: RecurrenceDraft, anchor: Date): string {
  const parts = [`FREQ=${draft.freq}`];
  if (draft.interval > 1) parts.push(`INTERVAL=${draft.interval}`);

  if (draft.freq === "WEEKLY") {
    const days = draft.byDay.length ? draft.byDay : [anchor.getDay()];
    parts.push(
      `BYDAY=${[...days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => WEEKDAY_CODES[d])
        .join(",")}`,
    );
  }
  if (draft.freq === "MONTHLY" && draft.monthlyMode === "weekday") {
    parts.push(`BYDAY=${nthWeekday(anchor)}${WEEKDAY_CODES[anchor.getDay()]}`);
  }

  const wantsDates =
    (draft.freq === "MONTHLY" && draft.monthlyMode === "day") || draft.freq === "YEARLY";
  if (wantsDates && draft.byMonthDay.length && !sameSet(draft.byMonthDay, [anchor.getDate()])) {
    parts.push(`BYMONTHDAY=${sortDays(draft.byMonthDay).join(",")}`);
  }
  if (draft.freq === "YEARLY" && draft.byMonth.length && !sameSet(draft.byMonth, [anchor.getMonth() + 1])) {
    parts.push(`BYMONTH=${[...new Set(draft.byMonth)].sort((a, b) => a - b).join(",")}`);
  }

  if (draft.end.type === "count") parts.push(`COUNT=${Math.max(1, draft.end.count)}`);
  if (draft.end.type === "until" && draft.end.date) {
    parts.push(`UNTIL=${untilValue(draft.end.date)}`);
  }
  return parts.join(";");
}

export function rruleToDraft(rrule: string, anchor: Date): RecurrenceDraft {
  const draft = defaultDraft(anchor);
  let byMonthDay: number[] | null = null;
  let byMonth: number[] | null = null;
  for (const part of rrule.replace(/^RRULE:/, "").split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined) continue;
    switch (key.toUpperCase()) {
      case "FREQ":
        if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value)) {
          draft.freq = value as RecurrenceFreq;
        }
        break;
      case "INTERVAL":
        draft.interval = Math.max(1, Number(value) || 1);
        break;
      case "BYDAY": {
        const codes = value.split(",");
        if (codes.some((code) => /^-?\d/.test(code))) {
          draft.monthlyMode = "weekday";
        } else {
          draft.byDay = codes
            .map((code) => WEEKDAY_CODES.indexOf(code.toUpperCase()))
            .filter((day) => day >= 0);
        }
        break;
      }
      case "BYMONTHDAY":
        byMonthDay = value
          .split(",")
          .map(Number)
          .filter((day) => (day >= 1 && day <= 31) || day === LAST_DAY);
        break;
      case "BYMONTH":
        byMonth = value
          .split(",")
          .map(Number)
          .filter((month) => month >= 1 && month <= 12);
        break;
      case "COUNT":
        draft.end = { type: "count", count: Math.max(1, Number(value) || 1) };
        break;
      case "UNTIL": {
        const match = /^(\d{4})(\d{2})(\d{2})/.exec(value);
        if (match) {
          const utc = new Date(
            Date.UTC(
              Number(match[1]),
              Number(match[2]) - 1,
              Number(match[3]),
              Number(value.slice(9, 11) || 0),
              Number(value.slice(11, 13) || 0),
              Number(value.slice(13, 15) || 0),
            ),
          );
          draft.end = {
            type: "until",
            date: `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}`,
          };
        }
        break;
      }
    }
  }
  if (draft.freq === "WEEKLY" && draft.byDay.length === 0) {
    draft.byDay = [anchor.getDay()];
  }
  if (draft.freq !== "WEEKLY") draft.byDay = [];

  const fresh = defaultDraft(anchor, draft.freq);
  draft.byMonthDay =
    draft.freq === "MONTHLY" || draft.freq === "YEARLY"
      ? sortDays(byMonthDay?.length ? byMonthDay : fresh.byMonthDay)
      : [];
  draft.byMonth =
    draft.freq === "YEARLY" ? [...new Set(byMonth?.length ? byMonth : fresh.byMonth)].sort((a, b) => a - b) : [];
  if (draft.freq !== "MONTHLY") draft.monthlyMode = "day";
  return draft;
}

export function describeRRule(rrule: string | null | undefined, anchor: Date): string {
  if (!rrule) return "Does not repeat";
  const draft = rruleToDraft(rrule, anchor);
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[draft.freq];
  let text = draft.interval === 1 ? `Every ${unit}` : `Every ${draft.interval} ${unit}s`;

  if (draft.freq === "WEEKLY") {
    const days = [...draft.byDay].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const isWeekdays = days.length === 5 && days.every((d) => d >= 1 && d <= 5);
    if (draft.interval === 1 && isWeekdays) text = "Every weekday";
    else text += ` on ${days.map((d) => WEEKDAY_LABELS[d]).join(", ")}`;
  } else if (draft.freq === "MONTHLY") {
    if (draft.monthlyMode === "weekday") {
      const nth = nthWeekday(anchor);
      const ordinal = nth === -1 ? "last" : ["", "first", "second", "third", "fourth", "fifth"][nth];
      text += ` on the ${ordinal} ${WEEKDAY_LONG[anchor.getDay()]}`;
    } else {
      const days = sortDays(draft.byMonthDay.length ? draft.byMonthDay : [anchor.getDate()]);
      text += ` on the ${listWithAnd(days.map(monthDayLabel))}`;
    }
  } else if (draft.freq === "YEARLY") {
    const months = [...new Set(draft.byMonth.length ? draft.byMonth : [anchor.getMonth() + 1])].sort((a, b) => a - b);
    const days = sortDays(draft.byMonthDay.length ? draft.byMonthDay : [anchor.getDate()]);
    if (months.length === 1 && days.length === 1) {
      text += ` on ${monthLabel(months[0])} ${days[0] === LAST_DAY ? "(last day)" : days[0]}`;
    } else {
      text += ` in ${listWithAnd(months.map(monthLabel))} on the ${listWithAnd(days.map(monthDayLabel))}`;
    }
  }

  if (draft.end.type === "count") {
    text += `, ${draft.end.count} time${draft.end.count === 1 ? "" : "s"}`;
  } else if (draft.end.type === "until") {
    const [y, m, d] = draft.end.date.split("-").map(Number);
    text += ` until ${new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return text;
}

export function buildRecurrenceInput(draft: RecurrenceDraft | null, anchor: Date): RecurrenceInput | null {
  if (!draft) return null;
  return {
    rrule: draftToRRule(draft, anchor),
    dtstart: anchor.toISOString(),
    timezone: deviceTimezone(),
  };
}

export type RecurrencePreset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "yearly" | "custom";

export function presetToDraft(preset: RecurrencePreset, anchor: Date): RecurrenceDraft | null {
  switch (preset) {
    case "none":
      return null;
    case "daily":
      return defaultDraft(anchor, "DAILY");
    case "weekly":
      return defaultDraft(anchor, "WEEKLY");
    case "weekdays":
      return { ...defaultDraft(anchor, "WEEKLY"), byDay: [1, 2, 3, 4, 5] };
    case "monthly":
      return defaultDraft(anchor, "MONTHLY");
    case "yearly":
      return defaultDraft(anchor, "YEARLY");
    case "custom":
      return defaultDraft(anchor, "WEEKLY");
  }
}

export function draftToPreset(draft: RecurrenceDraft | null, anchor: Date): RecurrencePreset {
  if (!draft) return "none";
  if (draft.interval !== 1 || draft.end.type !== "never") return "custom";
  switch (draft.freq) {
    case "DAILY":
      return "daily";
    case "WEEKLY": {
      const days = [...draft.byDay].sort();
      if (days.length === 5 && days.join() === "1,2,3,4,5") return "weekdays";
      if (days.length === 1 && days[0] === anchor.getDay()) return "weekly";
      return "custom";
    }
    case "MONTHLY":
      return draft.monthlyMode === "day" &&
        (draft.byMonthDay.length === 0 || sameSet(draft.byMonthDay, [anchor.getDate()]))
        ? "monthly"
        : "custom";
    case "YEARLY":
      return (draft.byMonth.length === 0 || sameSet(draft.byMonth, [anchor.getMonth() + 1])) &&
        (draft.byMonthDay.length === 0 || sameSet(draft.byMonthDay, [anchor.getDate()]))
        ? "yearly"
        : "custom";
  }
}

export function ordinal(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

export function ordinalWeek(anchor: Date) {
  const nth = Math.ceil(anchor.getDate() / 7);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const isLast = anchor.getDate() + 7 > lastOfMonth.getDate();
  if (isLast && nth >= 4) return "last";
  return ["", "first", "second", "third", "fourth", "fifth"][nth];
}

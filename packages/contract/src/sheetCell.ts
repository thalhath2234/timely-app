import type { SheetColumnType } from "./sheetTypes";

export function isFormulaValue(value: string) {
  return value.trim().startsWith("=");
}

const CURRENCY_PREFIX = /^(?:[A-Z]{3}|rs\.?|Rs\.?|RS\.?|R\$|kr|Kr|zł|Fr\.?|\p{Sc})\s*/u;
const CURRENCY_SUFFIX = /\s*(?:[A-Z]{3}|rs\.?|Rs\.?|RS\.?|kr|Kr|zł|Fr\.?|\p{Sc})$/u;
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

/**
 * Reads a number the way people type amounts: "$12.50", "Rs 1,250",
 * "LKR 500", "1.234,56", "(45.00)" for a negative, "12%" and "½".
 * Mirrors ParseNumberText in apps/api/internal/models/sheet.go.
 */
export function parseNumberInput(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  if (text in FRACTIONS) return FRACTIONS[text];
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const percent = text.endsWith("%");
  if (percent) text = text.slice(0, -1).trim();
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  for (let i = 0; i < 2; i += 1) {
    text = text.replace(CURRENCY_PREFIX, "").replace(CURRENCY_SUFFIX, "").trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  text = text.replace(/[\s  ']/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0 && lastComma > lastDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0 && lastDot < 0 && text.split(",").length === 2 && text.length - lastComma - 1 <= 2) {
    text = text.replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  let n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (negative) n = -n;
  if (percent) n /= 100;
  return n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

let cachedDayFirst: boolean | null = null;

/** True when this device writes dates day first (11/10/2026 is 11 October). */
export function localeDayFirst(): boolean {
  if (cachedDayFirst !== null) return cachedDayFirst;
  try {
    const parts = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(
      new Date(2026, 10, 22),
    );
    cachedDayFirst =
      parts.findIndex((part) => part.type === "day") < parts.findIndex((part) => part.type === "month");
  } catch {
    cachedDayFirst = false;
  }
  return cachedDayFirst;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isoFrom(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Reads a typed date as YYYY-MM-DD: ISO dates, "11 Oct 2026", "Oct 11",
 * "11/10/2026" (day or month first by the device's locale), "today",
 * "yesterday" and "tomorrow". Returns null when the text is not a date.
 */
export function parseDateInput(value: string, options: { dayFirst?: boolean; today?: Date } = {}): string | null {
  const text = value.trim();
  if (!text) return null;
  const today = options.today ?? new Date();
  const lower = text.toLowerCase();
  if (lower === "today") return localIso(today);
  if (lower === "yesterday" || lower === "tomorrow") {
    const shifted = new Date(today);
    shifted.setDate(shifted.getDate() + (lower === "tomorrow" ? 1 : -1));
    return localIso(shifted);
  }

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) return isoFrom(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(text);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = match[3] ? Number(match[3]) : today.getFullYear();
    const dayFirst = options.dayFirst ?? localeDayFirst();
    // An impossible month means the other order was meant (13/02 is 13 Feb).
    if (dayFirst ? b <= 12 : a > 12) return isoFrom(year, b, a);
    return isoFrom(year, a, b);
  }

  const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  // 11 Oct 2026, 11-Oct-26, 11 October
  match = /^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]{3,})\.?,?(?:[\s\-/.]+(\d{2}|\d{4}))?$/i.exec(text);
  if (match && monthIndex(match[2]) > 0) {
    return isoFrom(match[3] ? Number(match[3]) : today.getFullYear(), monthIndex(match[2]), Number(match[1]));
  }
  // Oct 11, 2026, October 11
  match = /^(?:[a-z]+,?\s+)?([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{2}|\d{4}))?$/i.exec(text);
  if (match && monthIndex(match[1]) > 0) {
    return isoFrom(match[3] ? Number(match[3]) : today.getFullYear(), monthIndex(match[1]), Number(match[2]));
  }
  return null;
}

/**
 * Coerces a typed value to the column type and reports whether it fits.
 * Formulas and blanks always fit. Mirrors ParseTypedCell in
 * apps/api/internal/models/sheet.go.
 */
export function parseTypedCell(
  type: SheetColumnType | undefined,
  value: string,
): { value: string; ok: boolean } {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed) || !type || type === "text") return { value, ok: true };

  if (type === "number" || type === "currency" || type === "percent" || type === "formula") {
    const parsed = parseNumberInput(trimmed);
    return parsed === null ? { value, ok: false } : { value: String(parsed), ok: true };
  }

  if (type === "date") {
    const parsed = parseDateInput(trimmed);
    return parsed === null ? { value, ok: false } : { value: parsed, ok: true };
  }

  if (type === "boolean") {
    const upper = trimmed.toUpperCase();
    if (["TRUE", "1", "YES", "Y", "ON", "✓", "✔", "X"].includes(upper)) return { value: "TRUE", ok: true };
    if (["FALSE", "0", "NO", "N", "OFF"].includes(upper)) return { value: "FALSE", ok: true };
    return { value, ok: false };
  }

  if (type === "select") return { value: trimmed, ok: true };

  return { value, ok: true };
}

/**
 * Coerces a typed value to the column type. Formulas and blanks are left
 * alone. A value that does not fit the type is kept as typed (the grid flags
 * it) so nothing a person enters is silently lost.
 */
export function normalizeTypedCell(type: SheetColumnType | undefined, value: string): string {
  return parseTypedCell(type, value).value;
}

/** True when a stored value fits its column type (blank and formulas always do). */
export function cellFitsType(type: SheetColumnType | undefined, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed)) return true;
  if (type === "number" || type === "currency" || type === "percent" || type === "formula") {
    return /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed);
  }
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (type === "boolean") return trimmed === "TRUE" || trimmed === "FALSE";
  return true;
}

/**
 * What a person typed into a cell, read the way spreadsheets do at entry
 * time: in a percent column "25" means 25% (stored as 0.25), like "25%" and
 * "0.25". Only used when typing, never when re-normalizing stored values.
 */
export function typedEntryForColumn(type: SheetColumnType | undefined, value: string): string {
  const trimmed = value.trim();
  if (type !== "percent" || !trimmed || isFormulaValue(trimmed) || trimmed.endsWith("%")) return value;
  const parsed = parseNumberInput(trimmed);
  if (parsed === null || Math.abs(parsed) < 1) return value;
  return String(Number((parsed / 100).toPrecision(15)));
}

/** The text an editor starts with: percent cells edit as "25%", not 0.25. */
export function editTextForCell(type: SheetColumnType | undefined, raw: string): string {
  if (type !== "percent" || isFormulaValue(raw)) return raw;
  const trimmed = raw.trim();
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) return raw;
  return `${Number((Number(trimmed) * 100).toPrecision(15))}%`;
}

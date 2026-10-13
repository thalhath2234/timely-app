/**
 * Value helpers shared by the formula engine, criteria matching and display:
 * calendar dates as spreadsheet serials, and spreadsheet-style comparison.
 */

export type CellResult =
  | { type: "number"; value: number }
  | { type: "text"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "empty" }
  | { type: "error"; message: string };

export type CalendarDate = { year: number; month: number; day: number };

/** Excel's serial-date epoch (day 1 = 1900-01-01, with the Lotus leap bug). */
const SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
export const DAY_MS = 86_400_000;

export function calendarFromUtc(ms: number): CalendarDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function utcFromCalendar(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export function calendarToSerial(date: CalendarDate): number {
  return Math.round((utcFromCalendar(date) - SERIAL_EPOCH_UTC) / DAY_MS);
}

export function serialToCalendar(serial: number): CalendarDate {
  return calendarFromUtc(SERIAL_EPOCH_UTC + Math.floor(serial) * DAY_MS);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function isoDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function serialToIso(serial: number): string {
  return isoDate(serialToCalendar(serial));
}

/** A YYYY-MM-DD (optionally with a time) string as a calendar date, or null. */
export function parseIsoDate(text: string): CalendarDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text.trim());
  if (!iso) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = Number(iso[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** The serial number of an ISO date string, or null when it is not one. */
export function isoDateSerial(text: string): number | null {
  const date = parseIsoDate(text);
  return date ? calendarToSerial(date) : null;
}

export function todayCalendar(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function numericValue(result: CellResult): number | null {
  if (result.type === "number") return result.value;
  if (result.type === "boolean") return null;
  if (result.type === "text") {
    const date = isoDateSerial(result.value);
    if (date !== null) return date;
    const trimmed = result.value.trim().replace(/,/g, "");
    if (trimmed !== "" && /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  }
  return null;
}

/**
 * Orders two values like a spreadsheet: numbers (and dates) numerically, text
 * case-insensitively, blanks as zero or empty text, and booleans after text.
 */
export function compareValues(left: CellResult, right: CellResult): number {
  if (left.type === "empty" && right.type === "empty") return 0;
  if (left.type === "boolean" || right.type === "boolean") {
    if (left.type === "boolean" && right.type === "boolean") return Number(left.value) - Number(right.value);
    return left.type === "boolean" ? 1 : -1;
  }
  const leftNumber = left.type === "empty" ? (right.type === "text" && numericValue(right) === null ? null : 0) : numericValue(left);
  const rightNumber = right.type === "empty" ? (left.type === "text" && numericValue(left) === null ? null : 0) : numericValue(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  // Text sorts after numbers.
  if (leftNumber !== null && left.type === "number") return -1;
  if (rightNumber !== null && right.type === "number") return 1;
  const a = left.type === "text" ? left.value.toLowerCase() : "";
  const b = right.type === "text" ? right.value.toLowerCase() : "";
  return a === b ? 0 : a < b ? -1 : 1;
}

/** A criteria test such as ">100", "<>Food", "Gro*" or "" (blank), as used by SUMIF and COUNTIF. */
export function criteriaMatcher(criterion: CellResult): (cell: CellResult) => boolean {
  if (criterion.type !== "text") {
    return (cell) => cell.type !== "empty" && cell.type !== "error" && compareValues(cell, criterion) === 0;
  }
  const match = /^(<>|>=|<=|=|>|<)?([\s\S]*)$/.exec(criterion.value)!;
  const operator = match[1] ?? "=";
  const operand = match[2];
  const isBlank = (cell: CellResult) => cell.type === "empty" || (cell.type === "text" && cell.value === "");

  if (operand === "") {
    if (operator === "=") return isBlank;
    if (operator === "<>") return (cell) => !isBlank(cell);
  }

  const literal: CellResult = /^(true|false)$/i.test(operand)
    ? { type: "boolean", value: operand.toLowerCase() === "true" }
    : { type: "text", value: operand };
  const operandNumber = numericValue(literal);

  if ((operator === "=" || operator === "<>") && operandNumber === null && literal.type === "text" && /[*?~]/.test(operand)) {
    const pattern = new RegExp(
      `^${operand.replace(/~([*?~])|([*?])|([.+^${}()|[\]\\])/g, (_, escaped, wild, special) =>
        escaped ? `\\${escaped}` : wild ? (wild === "*" ? "[\\s\\S]*" : "[\\s\\S]") : `\\${special}`,
      )}$`,
      "i",
    );
    const test = (cell: CellResult) => cell.type === "text" && pattern.test(cell.value);
    return operator === "=" ? test : (cell) => !test(cell);
  }

  return (cell) => {
    if (cell.type === "error") return false;
    if (operator === "<>") return isBlank(cell) ? true : compareValues(cell, literal) !== 0;
    if (isBlank(cell)) return false;
    // A number criterion only matches numbers; text criteria only text.
    const cellNumber = numericValue(cell);
    if (operandNumber !== null && cellNumber === null) return false;
    if (operandNumber === null && literal.type === "text" && cellNumber !== null && cell.type === "number") return false;
    const order = compareValues(cell, literal);
    switch (operator) {
      case ">":
        return order > 0;
      case "<":
        return order < 0;
      case ">=":
        return order >= 0;
      case "<=":
        return order <= 0;
      default:
        return order === 0;
    }
  };
}

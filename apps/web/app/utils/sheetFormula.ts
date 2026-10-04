import type { SheetColumn, SheetRow } from "@/app/_types/types";

export type CellResult =
  | { type: "number"; value: number }
  | { type: "text"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "empty" }
  | { type: "error"; message: string };

type EvalValue = CellResult | CellResult[];

const EMPTY: CellResult = { type: "empty" };

function error(message: string): CellResult {
  return { type: "error", message };
}

function isError(
  result: CellResult,
): result is { type: "error"; message: string } {
  return result.type === "error";
}

/** Coerces a cell to a number the way a spreadsheet does: blanks are zero. */
function toNumber(result: CellResult): number | CellResult {
  switch (result.type) {
    case "number":
      return result.value;
    case "boolean":
      return result.value ? 1 : 0;
    case "empty":
      return 0;
    case "error":
      return result;
    case "text": {
      const trimmed = result.value.trim();
      if (trimmed === "") return 0;
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? error("#VALUE!") : parsed;
    }
  }
}

function toText(result: CellResult): string {
  switch (result.type) {
    case "number":
      return String(result.value);
    case "boolean":
      return result.value ? "TRUE" : "FALSE";
    case "text":
      return result.value;
    case "error":
      return result.message;
    case "empty":
      return "";
  }
}

export function formatCellResult(result: CellResult): string {
  if (result.type === "number") {
    return Number.isFinite(result.value)
      ? String(Math.round(result.value * 1e10) / 1e10)
      : "#NUM!";
  }
  return toText(result);
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function columnIndexToLetter(index: number): string {
  let result = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

const A1_REF = /([A-Za-z]+)([0-9]+)/g;

/** Shift relative A1 references when filling a formula down or across. */
export function shiftFormula(
  value: string,
  deltaCol: number,
  deltaRow: number,
): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("=") || (deltaCol === 0 && deltaRow === 0))
    return value;

  let inString = false;
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString) {
      output += char;
      continue;
    }
    const range =
      /^([A-Za-z]+[0-9]*|[0-9]+)\s*:\s*([A-Za-z]+[0-9]*|[0-9]+)(?![A-Za-z0-9_])/.exec(
        value.slice(index),
      );
    if (range) {
      const shiftEndpoint = (part: string) => {
        const match = /^([A-Za-z]*)([0-9]*)$/.exec(part)!;
        return (
          (match[1]
            ? columnIndexToLetter(
                Math.max(0, columnLetterToIndex(match[1]) + deltaCol),
              )
            : "") +
          (match[2] ? String(Math.max(1, Number(match[2]) + deltaRow)) : "")
        );
      };
      output += `${shiftEndpoint(range[1])}:${shiftEndpoint(range[2])}`;
      index += range[0].length - 1;
      continue;
    }
    A1_REF.lastIndex = 0;
    const slice = value.slice(index);
    const match = A1_REF.exec(slice);
    if (match && match.index === 0) {
      const nextCol = Math.max(0, columnLetterToIndex(match[1]) + deltaCol);
      const nextRow = Math.max(1, Number(match[2]) + deltaRow);
      output += `${columnIndexToLetter(nextCol)}${nextRow}`;
      index += match[0].length - 1;
      continue;
    }
    output += char;
  }
  return output;
}

// ---- Tokenizer ----

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "ref"; col: number; row: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" }
  | { kind: "colon" };

const OPERATORS = [
  "<>",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "=",
  "<",
  ">",
  "%",
];

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let position = 0;

  while (position < input.length) {
    const char = input[position];

    if (/\s/.test(char)) {
      position += 1;
      continue;
    }

    if (char === '"') {
      let value = "";
      position += 1;
      while (position < input.length && input[position] !== '"') {
        value += input[position];
        position += 1;
      }
      if (position >= input.length) return "#PARSE!";
      position += 1;
      tokens.push({ kind: "string", value });
      continue;
    }

    if (
      /[0-9]/.test(char) ||
      (char === "." && /[0-9]/.test(input[position + 1] ?? ""))
    ) {
      let raw = "";
      while (position < input.length && /[0-9.]/.test(input[position])) {
        raw += input[position];
        position += 1;
      }
      const value = Number(raw);
      if (Number.isNaN(value)) return "#NUM!";
      tokens.push({ kind: "number", value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let raw = "";
      while (position < input.length && /[A-Za-z0-9_.]/.test(input[position])) {
        raw += input[position];
        position += 1;
      }

      const refMatch = /^([A-Za-z]+)([0-9]+)$/.exec(raw);
      if (refMatch) {
        tokens.push({
          kind: "ref",
          col: columnLetterToIndex(refMatch[1]),
          row: Number(refMatch[2]) - 1,
        });
      } else {
        tokens.push({ kind: "identifier", value: raw.toUpperCase() });
      }
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      position += 1;
      continue;
    }

    if (char === "," || char === ";") {
      tokens.push({ kind: "comma" });
      position += 1;
      continue;
    }

    if (char === ":") {
      tokens.push({ kind: "colon" });
      position += 1;
      continue;
    }

    const operator = OPERATORS.find((candidate) =>
      input.startsWith(candidate, position),
    );
    if (operator) {
      tokens.push({ kind: "operator", value: operator });
      position += operator.length;
      continue;
    }

    return "#PARSE!";
  }

  return tokens;
}

// ---- Evaluator ----

interface CellLookup {
  (col: number, row: number): CellResult;
}

function flatten(values: EvalValue[]): CellResult[] {
  return values.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function numericArgs(values: EvalValue[]): number[] | CellResult {
  const numbers: number[] = [];

  for (const cell of flatten(values)) {
    if (isError(cell)) return cell;
    // Ranges routinely contain blanks and labels; those are skipped rather
    // than poisoning the aggregate.
    if (cell.type === "empty") continue;
    if (cell.type === "text" && cell.value.trim() === "") continue;

    const numeric = toNumber(cell);
    if (typeof numeric !== "number") {
      if (cell.type === "text") continue;
      return numeric;
    }
    numbers.push(numeric);
  }

  return numbers;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

type CalendarDate = { year: number; month: number; day: number };

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Excel's serial-date epoch (day 1 = 1900-01-01, with the Lotus leap bug). */
const SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function calendarFromUtc(ms: number): CalendarDate {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function utcFromCalendar(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function todayCalendar(): CalendarDate {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/**
 * Reads a cell as a calendar date. Date columns store YYYY-MM-DD; typed text
 * may also be an ISO timestamp or anything Date.parse understands; numbers are
 * treated as spreadsheet serial dates.
 */
function toCalendarDate(result: CellResult): CalendarDate | CellResult {
  if (isError(result)) return result;
  if (result.type === "empty") return error("#VALUE!");
  if (result.type === "boolean") return error("#VALUE!");
  if (result.type === "number") {
    if (!Number.isFinite(result.value)) return error("#NUM!");
    return calendarFromUtc(
      SERIAL_EPOCH_UTC + Math.floor(result.value) * DAY_MS,
    );
  }
  const trimmed = result.value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return error("#VALUE!");
    }
    return { year, month, day };
  }
  if (trimmed === "") return error("#VALUE!");
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return error("#VALUE!");
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
}

function isCalendarDate(
  value: CalendarDate | CellResult,
): value is CalendarDate {
  return "year" in value;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isoDate(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** 0 = Sunday … 6 = Saturday, independent of the local time zone. */
function weekdayIndex(date: CalendarDate): number {
  return new Date(utcFromCalendar(date)).getUTCDay();
}

/** Excel WEEKDAY return types: 1 → Sun=1..Sat=7, 2 → Mon=1..Sun=7, 3 → Mon=0..Sun=6. */
function weekdayNumber(date: CalendarDate, type: number): number | CellResult {
  const sunday0 = weekdayIndex(date);
  switch (type) {
    case 1:
      return sunday0 + 1;
    case 2:
      return ((sunday0 + 6) % 7) + 1;
    case 3:
      return (sunday0 + 6) % 7;
    default:
      return error("#NUM!");
  }
}

const DATE_TOKEN_RE = /dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi;

function looksLikeDateFormat(format: string) {
  return /d|m|y/i.test(format) && !/[#0]/.test(format);
}

function formatDateText(date: CalendarDate, format: string): string {
  return format.replace(DATE_TOKEN_RE, (token) => {
    switch (token.toLowerCase()) {
      case "dddd":
        return WEEKDAY_NAMES[weekdayIndex(date)];
      case "ddd":
        return WEEKDAY_NAMES[weekdayIndex(date)].slice(0, 3);
      case "dd":
        return pad2(date.day);
      case "d":
        return String(date.day);
      case "mmmm":
        return MONTH_NAMES[date.month - 1];
      case "mmm":
        return MONTH_NAMES[date.month - 1].slice(0, 3);
      case "mm":
        return pad2(date.month);
      case "m":
        return String(date.month);
      case "yyyy":
        return String(date.year);
      case "yy":
        return pad2(date.year % 100);
      default:
        return token;
    }
  });
}

/** Number patterns: 0, 0.00, #,##0, #,##0.00, 0%, 0.0%. Anything else prints plainly. */
function formatNumberText(value: number, format: string): string {
  const percent = format.includes("%");
  const scaled = percent ? value * 100 : value;
  const decimalsMatch = /\.(0+)/.exec(format);
  const decimals = decimalsMatch ? decimalsMatch[1].length : 0;
  const grouped = format.includes(",");
  const body = grouped
    ? scaled.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : scaled.toFixed(decimals);
  return percent ? `${body}%` : body;
}

function textFunction(value: CellResult, format: string): CellResult {
  if (isError(value)) return value;
  if (looksLikeDateFormat(format)) {
    const date = toCalendarDate(value);
    if (!isCalendarDate(date)) return date;
    return { type: "text", value: formatDateText(date, format) };
  }
  const numeric = toNumber(value);
  if (typeof numeric !== "number") return numeric;
  if (!/[#0]/.test(format)) return { type: "text", value: toText(value) };
  return { type: "text", value: formatNumberText(numeric, format) };
}

function callFunction(name: string, args: EvalValue[]): CellResult {
  const single = (index: number): CellResult => {
    const value = args[index];
    if (value === undefined) return EMPTY;
    return Array.isArray(value) ? (value[0] ?? EMPTY) : value;
  };

  switch (name) {
    case "SUM":
    case "AVERAGE":
    case "AVG":
    case "MIN":
    case "MAX":
    case "PRODUCT": {
      const numbers = numericArgs(args);
      if (!Array.isArray(numbers)) return numbers;
      if (numbers.length === 0) {
        return name === "SUM" || name === "PRODUCT"
          ? { type: "number", value: 0 }
          : error("#DIV/0!");
      }

      switch (name) {
        case "SUM":
          return { type: "number", value: numbers.reduce((a, b) => a + b, 0) };
        case "PRODUCT":
          return { type: "number", value: numbers.reduce((a, b) => a * b, 1) };
        case "MIN":
          return { type: "number", value: Math.min(...numbers) };
        case "MAX":
          return { type: "number", value: Math.max(...numbers) };
        default:
          return {
            type: "number",
            value: numbers.reduce((a, b) => a + b, 0) / numbers.length,
          };
      }
    }

    case "COUNT": {
      const numbers = numericArgs(args);
      if (!Array.isArray(numbers)) return numbers;
      return { type: "number", value: numbers.length };
    }

    case "COUNTA": {
      const filled = flatten(args).filter(
        (cell) =>
          cell.type !== "empty" &&
          !(cell.type === "text" && cell.value.trim() === ""),
      );
      return { type: "number", value: filled.length };
    }

    case "ABS":
    case "SQRT":
    case "ROUND":
    case "FLOOR":
    case "CEILING": {
      const first = toNumber(single(0));
      if (typeof first !== "number") return first;

      if (name === "ABS") return { type: "number", value: Math.abs(first) };
      if (name === "SQRT") {
        return first < 0
          ? error("#NUM!")
          : { type: "number", value: Math.sqrt(first) };
      }
      if (name === "FLOOR") return { type: "number", value: Math.floor(first) };
      if (name === "CEILING")
        return { type: "number", value: Math.ceil(first) };

      const digitsArg = args.length > 1 ? toNumber(single(1)) : 0;
      if (typeof digitsArg !== "number") return digitsArg;
      const factor = 10 ** digitsArg;
      return { type: "number", value: Math.round(first * factor) / factor };
    }

    case "POWER": {
      const base = toNumber(single(0));
      const exponent = toNumber(single(1));
      if (typeof base !== "number") return base;
      if (typeof exponent !== "number") return exponent;
      return { type: "number", value: base ** exponent };
    }

    case "IF": {
      const condition = single(0);
      if (isError(condition)) return condition;

      const isTruthy =
        condition.type === "boolean"
          ? condition.value
          : condition.type === "number"
            ? condition.value !== 0
            : condition.type === "text"
              ? condition.value.trim() !== "" &&
                condition.value.toUpperCase() !== "FALSE"
              : false;

      return isTruthy ? single(1) : args[2] === undefined ? EMPTY : single(2);
    }

    case "AND":
    case "OR": {
      const cells = flatten(args);
      const flags: boolean[] = [];

      for (const cell of cells) {
        if (isError(cell)) return cell;
        if (cell.type === "empty") continue;
        flags.push(
          cell.type === "boolean"
            ? cell.value
            : toText(cell).toUpperCase() !== "FALSE",
        );
      }

      return {
        type: "boolean",
        value: name === "AND" ? flags.every(Boolean) : flags.some(Boolean),
      };
    }

    case "NOT": {
      const first = single(0);
      if (isError(first)) return first;
      return {
        type: "boolean",
        value: !(first.type === "boolean"
          ? first.value
          : toText(first).toUpperCase() !== "FALSE" && toText(first) !== ""),
      };
    }

    case "CONCAT":
    case "CONCATENATE":
      return { type: "text", value: flatten(args).map(toText).join("") };

    case "LEN":
      return { type: "number", value: toText(single(0)).length };

    case "UPPER":
      return { type: "text", value: toText(single(0)).toUpperCase() };

    case "LOWER":
      return { type: "text", value: toText(single(0)).toLowerCase() };

    case "TRIM":
      return { type: "text", value: toText(single(0)).trim() };

    case "TODAY":
      return { type: "text", value: isoDate(todayCalendar()) };

    case "DATE": {
      const year = toNumber(single(0));
      const month = toNumber(single(1));
      const day = toNumber(single(2));
      if (typeof year !== "number") return year;
      if (typeof month !== "number") return month;
      if (typeof day !== "number") return day;
      const ms = Date.UTC(
        Math.trunc(year),
        Math.trunc(month) - 1,
        Math.trunc(day),
      );
      if (!Number.isFinite(ms)) return error("#NUM!");
      return { type: "text", value: isoDate(calendarFromUtc(ms)) };
    }

    case "YEAR":
    case "MONTH":
    case "DAY": {
      const date = toCalendarDate(single(0));
      if (!isCalendarDate(date)) return date;
      const value =
        name === "YEAR" ? date.year : name === "MONTH" ? date.month : date.day;
      return { type: "number", value };
    }

    case "WEEKDAY": {
      const date = toCalendarDate(single(0));
      if (!isCalendarDate(date)) return date;
      const typeArg = args.length > 1 ? toNumber(single(1)) : 1;
      if (typeof typeArg !== "number") return typeArg;
      const value = weekdayNumber(date, Math.trunc(typeArg) || 1);
      return typeof value === "number" ? { type: "number", value } : value;
    }

    case "DAYS": {
      const end = toCalendarDate(single(0));
      if (!isCalendarDate(end)) return end;
      const start = toCalendarDate(single(1));
      if (!isCalendarDate(start)) return start;
      return {
        type: "number",
        value: Math.round(
          (utcFromCalendar(end) - utcFromCalendar(start)) / DAY_MS,
        ),
      };
    }

    case "TEXT": {
      const format = single(1);
      if (isError(format)) return format;
      return textFunction(single(0), toText(format));
    }

    default:
      return error("#NAME?");
  }
}

function applyBinary(
  operator: string,
  left: CellResult,
  right: CellResult,
): CellResult {
  if (isError(left)) return left;
  if (isError(right)) return right;

  if (operator === "&") {
    return { type: "text", value: toText(left) + toText(right) };
  }

  if (["=", "<>", "<", ">", "<=", ">="].includes(operator)) {
    const leftNumber = toNumber(left);
    const rightNumber = toNumber(right);

    if (typeof leftNumber === "number" && typeof rightNumber === "number") {
      switch (operator) {
        case "=":
          return { type: "boolean", value: leftNumber === rightNumber };
        case "<>":
          return { type: "boolean", value: leftNumber !== rightNumber };
        case "<":
          return { type: "boolean", value: leftNumber < rightNumber };
        case ">":
          return { type: "boolean", value: leftNumber > rightNumber };
        case "<=":
          return { type: "boolean", value: leftNumber <= rightNumber };
        default:
          return { type: "boolean", value: leftNumber >= rightNumber };
      }
    }

    const leftText = toText(left);
    const rightText = toText(right);
    switch (operator) {
      case "=":
        return { type: "boolean", value: leftText === rightText };
      case "<>":
        return { type: "boolean", value: leftText !== rightText };
      case "<":
        return { type: "boolean", value: leftText < rightText };
      case ">":
        return { type: "boolean", value: leftText > rightText };
      case "<=":
        return { type: "boolean", value: leftText <= rightText };
      default:
        return { type: "boolean", value: leftText >= rightText };
    }
  }

  const leftNumber = toNumber(left);
  if (typeof leftNumber !== "number") return leftNumber;
  const rightNumber = toNumber(right);
  if (typeof rightNumber !== "number") return rightNumber;

  switch (operator) {
    case "+":
      return { type: "number", value: leftNumber + rightNumber };
    case "-":
      return { type: "number", value: leftNumber - rightNumber };
    case "*":
      return { type: "number", value: leftNumber * rightNumber };
    case "/":
      return rightNumber === 0
        ? error("#DIV/0!")
        : { type: "number", value: leftNumber / rightNumber };
    case "^":
      return { type: "number", value: leftNumber ** rightNumber };
    default:
      return error("#PARSE!");
  }
}

function parseFormula(
  tokens: Token[],
  lookup: CellLookup,
  columnCount: number,
  rowCount: number,
): CellResult {
  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];

  const single = (value: EvalValue): CellResult =>
    Array.isArray(value) ? (value[0] ?? EMPTY) : value;

  function parseExpression(): EvalValue {
    let left = parseAdditive();

    while (
      peek()?.kind === "operator" &&
      ["=", "<>", "<", ">", "<=", ">="].includes(
        (peek() as { value: string }).value,
      )
    ) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, single(left), single(parseAdditive()));
    }

    return left;
  }

  function parseAdditive(): EvalValue {
    let left = parseMultiplicative();

    while (
      peek()?.kind === "operator" &&
      ["+", "-", "&"].includes((peek() as { value: string }).value)
    ) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, single(left), single(parseMultiplicative()));
    }

    return left;
  }

  function parseMultiplicative(): EvalValue {
    let left = parsePower();

    while (
      peek()?.kind === "operator" &&
      ["*", "/"].includes((peek() as { value: string }).value)
    ) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, single(left), single(parsePower()));
    }

    return left;
  }

  function parsePower(): EvalValue {
    const left = parseUnary();

    if (
      peek()?.kind === "operator" &&
      (peek() as { value: string }).value === "^"
    ) {
      next();
      return applyBinary("^", single(left), single(parsePower()));
    }

    return left;
  }

  function parseUnary(): EvalValue {
    const token = peek();

    if (
      token?.kind === "operator" &&
      (token.value === "-" || token.value === "+")
    ) {
      next();
      const operand = single(parseUnary());
      if (isError(operand)) return operand;
      const numeric = toNumber(operand);
      if (typeof numeric !== "number") return numeric;
      return {
        type: "number",
        value: token.value === "-" ? -numeric : numeric,
      };
    }

    return parsePostfix();
  }

  /** Postfix percent, spreadsheet style: `50%` is 0.5, `A1%%` is A1/10000.
   * Binds tighter than `^` and looser than unary minus, matching Excel. */
  function parsePostfix(): EvalValue {
    let value = parsePrimary();
    while (
      peek()?.kind === "operator" &&
      (peek() as { value: string }).value === "%"
    ) {
      next();
      const operand = single(value);
      if (isError(operand)) return operand;
      const numeric = toNumber(operand);
      if (typeof numeric !== "number") return numeric;
      value = { type: "number", value: numeric / 100 };
    }
    return value;
  }

  function parsePrimary(): EvalValue {
    const token = next();
    if (!token) return error("#PARSE!");

    if (peek()?.kind === "colon") {
      next();
      const end = next();
      // Missing row/column coordinates expand to the current grid boundary.
      // Re-evaluation against a larger grid includes newly added rows/columns.
      const endpoint = (
        part: Token | undefined,
      ): { col?: number; row?: number } | null => {
        if (part?.kind === "ref") return { col: part.col, row: part.row };
        if (part?.kind === "identifier" && /^[A-Z]+$/.test(part.value))
          return { col: columnLetterToIndex(part.value) };
        if (part?.kind === "number" && Number.isSafeInteger(part.value))
          return { row: part.value - 1 };
        return null;
      };
      const start = endpoint(token);
      const finish = endpoint(end);
      if (!start || !finish) return error("#PARSE!");
      if (
        (start.col === undefined && finish.row === undefined) ||
        (start.row === undefined && finish.col === undefined)
      )
        return error("#PARSE!");
      for (const coordinate of [start.col, start.row, finish.col, finish.row]) {
        if (
          coordinate !== undefined &&
          (!Number.isSafeInteger(coordinate) || coordinate < 0)
        )
          return error("#REF!");
      }
      const left = start.col ?? 0;
      const right = finish.col ?? columnCount - 1;
      const top = start.row ?? 0;
      const bottom = finish.row ?? rowCount - 1;
      const cells: CellResult[] = [];
      // Only visit actual grid cells, even for very large explicit bounds.
      const startCol = Math.max(0, Math.min(left, right));
      const endCol = Math.min(columnCount - 1, Math.max(left, right));
      const startRow = Math.max(0, Math.min(top, bottom));
      const endRow = Math.min(rowCount - 1, Math.max(top, bottom));
      // An open range starting beyond the grid is empty, not reversed.
      if (
        (finish.row === undefined && top >= rowCount) ||
        (finish.col === undefined && left >= columnCount)
      )
        return cells;
      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = startCol; col <= endCol; col += 1)
          cells.push(lookup(col, row));
      }
      return cells;
    }

    if (token.kind === "number") return { type: "number", value: token.value };
    if (token.kind === "string") return { type: "text", value: token.value };
    if (token.kind === "ref") return lookup(token.col, token.row);

    if (token.kind === "identifier") {
      if (token.value === "TRUE") return { type: "boolean", value: true };
      if (token.value === "FALSE") return { type: "boolean", value: false };

      if (peek()?.kind !== "paren") return error("#NAME?");
      next();

      const args: EvalValue[] = [];
      if (
        !(
          peek()?.kind === "paren" &&
          (peek() as { value: string }).value === ")"
        )
      ) {
        args.push(parseExpression());
        while (peek()?.kind === "comma") {
          next();
          args.push(parseExpression());
        }
      }

      const closing = next();
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        return error("#PARSE!");
      }

      return callFunction(token.value, args);
    }

    if (token.kind === "paren" && token.value === "(") {
      const value = parseExpression();
      const closing = next();
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        return error("#PARSE!");
      }
      return value;
    }

    return error("#PARSE!");
  }

  const result = parseExpression();
  if (position < tokens.length) return error("#PARSE!");
  return single(result);
}

function parseLiteral(raw: string): CellResult {
  const trimmed = raw.trim();
  if (trimmed === "") return EMPTY;

  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return { type: "boolean", value: true };
  if (upper === "FALSE") return { type: "boolean", value: false };

  // Accept "1,234.5" and "42%" as numbers, everything else stays text.
  const numericCandidate = trimmed.replace(/,/g, "");
  if (/^-?\d*\.?\d+%$/.test(numericCandidate)) {
    return {
      type: "number",
      value: Number(numericCandidate.slice(0, -1)) / 100,
    };
  }
  if (/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(numericCandidate)) {
    return { type: "number", value: Number(numericCandidate) };
  }

  return { type: "text", value: trimmed };
}

/**
 * Builds a memoized evaluator over the grid. Formulas may reference other
 * cells by A1 notation; circular references resolve to #CYCLE! instead of
 * recursing forever.
 */
export function createSheetEvaluator(columns: SheetColumn[], rows: SheetRow[]) {
  const cache = new Map<string, CellResult>();
  const visiting = new Set<string>();

  const rawAt = (col: number, row: number): string => {
    const column = columns[col];
    const sheetRow = rows[row];
    if (!column || !sheetRow) return "";
    return sheetRow.cells?.[column.id] ?? "";
  };

  const valueAt: CellLookup = (col, row) => {
    const key = `${col}:${row}`;

    const cached = cache.get(key);
    if (cached) return cached;

    if (visiting.has(key)) return error("#CYCLE!");

    const raw = rawAt(col, row).trim();
    if (!raw.startsWith("=")) {
      const literal = parseLiteral(raw);
      cache.set(key, literal);
      return literal;
    }

    visiting.add(key);
    const tokens = tokenize(raw.slice(1));
    const result =
      typeof tokens === "string"
        ? error(tokens)
        : parseFormula(tokens, valueAt, columns.length, rows.length);
    visiting.delete(key);

    cache.set(key, result);
    return result;
  };

  return {
    valueAt,
    displayAt: (col: number, row: number) =>
      formatCellResult(valueAt(col, row)),
    isFormula: (col: number, row: number) =>
      rawAt(col, row).trim().startsWith("="),
  };
}

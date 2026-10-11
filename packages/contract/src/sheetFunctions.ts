import {
  calendarFromUtc,
  calendarToSerial,
  compareValues,
  criteriaMatcher,
  DAY_MS,
  isoDate,
  isoDateSerial,
  parseIsoDate,
  serialToCalendar,
  serialToIso,
  todayCalendar,
  utcFromCalendar,
  type CalendarDate,
  type CellResult,
} from "./sheetValues";

export type { CellResult };

/** A rectangular block of cells, read row by row. */
export type RangeValue = CellResult[] & { rows: number; cols: number };
export type EvalValue = CellResult | RangeValue;

export const EMPTY: CellResult = { type: "empty" };

export function error(message: string): CellResult {
  return { type: "error", message };
}

export function isError(result: CellResult): result is { type: "error"; message: string } {
  return result.type === "error";
}

export function makeRange(cells: CellResult[], rows: number, cols: number): RangeValue {
  const range = cells as RangeValue;
  range.rows = rows;
  range.cols = cols;
  return range;
}

export function isRange(value: EvalValue | undefined): value is RangeValue {
  return Array.isArray(value);
}

export function single(value: EvalValue | undefined): CellResult {
  if (value === undefined) return EMPTY;
  return isRange(value) ? (value[0] ?? EMPTY) : value;
}

function asRange(value: EvalValue | undefined): RangeValue {
  if (value === undefined) return makeRange([], 0, 0);
  return isRange(value) ? value : makeRange([value], 1, 1);
}

/** Coerces a cell to a number the way a spreadsheet does: blanks are zero,
 * dates are serial numbers. */
export function toNumber(result: CellResult): number | CellResult {
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
      const date = isoDateSerial(trimmed);
      if (date !== null) return date;
      const cleaned = trimmed.replace(/,/g, "");
      if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?%?$/i.test(cleaned)) {
        return cleaned.endsWith("%") ? Number(cleaned.slice(0, -1)) / 100 : Number(cleaned);
      }
      return error("#VALUE!");
    }
  }
}

export function toText(result: CellResult): string {
  switch (result.type) {
    case "number":
      return Number.isFinite(result.value) ? String(Number(result.value.toPrecision(15))) : "#NUM!";
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

function truthy(cell: CellResult): boolean | CellResult {
  switch (cell.type) {
    case "boolean":
      return cell.value;
    case "number":
      return cell.value !== 0;
    case "empty":
      return false;
    case "error":
      return cell;
    case "text": {
      const upper = cell.value.trim().toUpperCase();
      if (upper === "TRUE") return true;
      if (upper === "FALSE" || upper === "") return false;
      const numeric = toNumber(cell);
      return typeof numeric === "number" ? numeric !== 0 : error("#VALUE!");
    }
  }
}

function flatten(values: EvalValue[]): CellResult[] {
  return values.flatMap((value) => (isRange(value) ? value : [value]));
}

/** Numbers from the arguments. Cells in ranges that hold text or blanks are
 * skipped; values typed straight into the call are coerced. */
function numericArgs(values: EvalValue[]): number[] | CellResult {
  const numbers: number[] = [];
  for (const value of values) {
    if (isRange(value)) {
      for (const cell of value) {
        if (isError(cell)) return cell;
        if (cell.type === "number") numbers.push(cell.value);
        else if (cell.type === "text") {
          const trimmed = cell.value.trim().replace(/,/g, "");
          if (trimmed !== "" && /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) numbers.push(Number(trimmed));
        }
      }
      continue;
    }
    if (value.type === "empty") continue;
    const numeric = toNumber(value);
    if (typeof numeric !== "number") return numeric;
    numbers.push(numeric);
  }
  return numbers;
}

/** True when every non-blank value is an ISO date, so MIN/MAX answer with a date. */
function allDates(values: EvalValue[]): boolean {
  let seen = false;
  for (const cell of flatten(values)) {
    if (cell.type === "empty" || (cell.type === "text" && cell.value.trim() === "")) continue;
    if (cell.type !== "text" || isoDateSerial(cell.value) === null) return false;
    seen = true;
  }
  return seen;
}

function dateSerials(values: EvalValue[]): number[] {
  return flatten(values)
    .map((cell) => (cell.type === "text" ? isoDateSerial(cell.value) : null))
    .filter((serial): serial is number => serial !== null);
}

const num = (value: number): CellResult =>
  Number.isFinite(value) ? { type: "number", value } : error("#NUM!");
const text = (value: string): CellResult => ({ type: "text", value });
const bool = (value: boolean): CellResult => ({ type: "boolean", value });

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Reads a cell as a calendar date: YYYY-MM-DD text, a serial number, or text Date.parse understands. */
function toCalendarDate(result: CellResult): CalendarDate | CellResult {
  if (isError(result)) return result;
  if (result.type === "empty" || result.type === "boolean") return error("#VALUE!");
  if (result.type === "number") {
    if (!Number.isFinite(result.value)) return error("#NUM!");
    return serialToCalendar(result.value);
  }
  const trimmed = result.value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return parseIsoDate(trimmed.slice(0, 10)) ?? error("#VALUE!");
  }
  if (trimmed === "") return error("#VALUE!");
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return error("#VALUE!");
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function isCalendarDate(value: CalendarDate | CellResult): value is CalendarDate {
  return "year" in value;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
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

function addMonths(date: CalendarDate, months: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(date.day, last) };
}

function endOfMonth(date: CalendarDate, months: number): CalendarDate {
  const shifted = addMonths({ ...date, day: 1 }, months);
  return { ...shifted, day: new Date(Date.UTC(shifted.year, shifted.month, 0)).getUTCDate() };
}

function isoWeek(date: CalendarDate): number {
  const target = new Date(utcFromCalendar(date));
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const DATE_TOKEN_RE = /dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi;

function looksLikeDateFormat(format: string) {
  return /d|m|y/i.test(format) && !/[#0]/.test(format);
}

export function formatDateText(date: CalendarDate, format: string): string {
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
    ? scaled.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : scaled.toFixed(decimals);
  return percent ? `${body}%` : body;
}

function textFunction(value: CellResult, format: string): CellResult {
  if (isError(value)) return value;
  if (looksLikeDateFormat(format)) {
    const date = toCalendarDate(value);
    if (!isCalendarDate(date)) return date;
    return text(formatDateText(date, format));
  }
  const numeric = toNumber(value);
  if (typeof numeric !== "number") return numeric;
  if (!/[#0]/.test(format)) return text(toText(value));
  return text(formatNumberText(numeric, format));
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

/** Position (0-based) of value in cells: 0 = exact (wildcards allowed for
 * text), 1 = largest value <= target (sorted ascending), -1 = smallest >= target. */
function findIndex(target: CellResult, cells: CellResult[], mode: number): number {
  if (mode === 0) {
    const test =
      target.type === "text" && /[*?~]/.test(target.value)
        ? criteriaMatcher(text(`=${target.value}`))
        : (cell: CellResult) => cell.type !== "empty" && compareValues(cell, target) === 0;
    return cells.findIndex(test);
  }
  let best = -1;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.type === "empty" || cell.type === "error") continue;
    const order = compareValues(cell, target);
    if (order === 0) return i;
    if (mode > 0) {
      if (order < 0) best = i;
      else break;
    } else if (order > 0) {
      best = i;
    } else {
      break;
    }
  }
  return best;
}

function column(range: RangeValue, index: number): CellResult[] {
  const out: CellResult[] = [];
  for (let row = 0; row < range.rows; row += 1) out.push(range[row * range.cols + index] ?? EMPTY);
  return out;
}

function row(range: RangeValue, index: number): CellResult[] {
  return range.slice(index * range.cols, index * range.cols + range.cols);
}

/** Pairs of criteria ranges and criteria → the indexes that match all of them. */
function matchingIndexes(pairs: EvalValue[], length: number): number[] | CellResult {
  const tests: { cells: RangeValue; test: (cell: CellResult) => boolean }[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const criterion = single(pairs[i + 1]);
    if (isError(criterion)) return criterion;
    tests.push({ cells: asRange(pairs[i]), test: criteriaMatcher(criterion) });
  }
  if (tests.length === 0 || pairs.length % 2 !== 0) return error("#N/A");
  const out: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (tests.every(({ cells, test }) => test(cells[index] ?? EMPTY))) out.push(index);
  }
  return out;
}

function numbersAt(cells: RangeValue, indexes: number[]): number[] {
  const out: number[] = [];
  for (const index of indexes) {
    const cell = cells[index];
    if (cell?.type === "number") out.push(cell.value);
    else if (cell?.type === "text") {
      const trimmed = cell.value.trim().replace(/,/g, "");
      if (trimmed !== "" && /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(trimmed)) out.push(Number(trimmed));
    }
  }
  return out;
}

function stats(numbers: number[], sample: boolean): number | CellResult {
  const n = numbers.length;
  if (n === 0 || (sample && n < 2)) return error("#DIV/0!");
  const mean = numbers.reduce((a, b) => a + b, 0) / n;
  return numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample ? n - 1 : n);
}

/* ------------------------------------------------------------------ */
/* Functions                                                           */
/* ------------------------------------------------------------------ */

export interface CallContext {
  row: number;
  col: number;
}

export function callFunction(name: string, args: EvalValue[], context: CallContext): CellResult {
  const arg = (index: number): CellResult => single(args[index]);
  const numberArg = (index: number, fallback?: number): number | CellResult => {
    if (args[index] === undefined || (fallback !== undefined && arg(index).type === "empty")) {
      return fallback ?? error("#N/A");
    }
    return toNumber(arg(index));
  };
  const textArg = (index: number) => toText(arg(index));
  const firstError = (...values: CellResult[]) => values.find(isError);

  switch (name) {
    // ---- Math & statistics ----
    case "SUM":
    case "AVERAGE":
    case "AVG":
    case "MIN":
    case "MAX":
    case "PRODUCT":
    case "MEDIAN": {
      if ((name === "MIN" || name === "MAX") && allDates(args)) {
        const serials = dateSerials(args);
        return text(serialToIso(name === "MIN" ? Math.min(...serials) : Math.max(...serials)));
      }
      const numbers = numericArgs(args);
      if (!Array.isArray(numbers)) return numbers;
      if (numbers.length === 0) {
        if (name === "SUM" || name === "PRODUCT" || name === "MIN" || name === "MAX") return num(0);
        return error("#DIV/0!");
      }
      switch (name) {
        case "SUM":
          return num(numbers.reduce((a, b) => a + b, 0));
        case "PRODUCT":
          return num(numbers.reduce((a, b) => a * b, 1));
        case "MIN":
          return num(Math.min(...numbers));
        case "MAX":
          return num(Math.max(...numbers));
        case "MEDIAN": {
          const sorted = [...numbers].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return num(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
        }
        default:
          return num(numbers.reduce((a, b) => a + b, 0) / numbers.length);
      }
    }

    case "COUNT": {
      const numbers = numericArgs(args.map((value) => (isRange(value) ? value : value)));
      if (!Array.isArray(numbers)) {
        // COUNT ignores errors and text instead of failing.
        return num(flatten(args).filter((cell) => cell.type === "number").length);
      }
      return num(numbers.length);
    }

    case "COUNTA":
      return num(
        flatten(args).filter((cell) => cell.type !== "empty" && !(cell.type === "text" && cell.value.trim() === ""))
          .length,
      );

    case "COUNTBLANK":
      return num(flatten(args).filter((cell) => cell.type === "empty" || (cell.type === "text" && cell.value.trim() === "")).length);

    case "ABS":
    case "SQRT":
    case "INT":
    case "EXP":
    case "LN":
    case "LOG10":
    case "SIGN":
    case "EVEN":
    case "ODD": {
      const first = numberArg(0);
      if (typeof first !== "number") return first;
      switch (name) {
        case "ABS":
          return num(Math.abs(first));
        case "SQRT":
          return first < 0 ? error("#NUM!") : num(Math.sqrt(first));
        case "INT":
          return num(Math.floor(first));
        case "EXP":
          return num(Math.exp(first));
        case "LN":
          return first <= 0 ? error("#NUM!") : num(Math.log(first));
        case "LOG10":
          return first <= 0 ? error("#NUM!") : num(Math.log10(first));
        case "SIGN":
          return num(Math.sign(first));
        case "EVEN": {
          const up = Math.ceil(Math.abs(first) / 2) * 2;
          return num(first < 0 ? -up : up);
        }
        default: {
          let up = Math.ceil(Math.abs(first));
          if (up % 2 === 0) up += 1;
          return num(first < 0 ? -up : up);
        }
      }
    }

    case "LOG": {
      const value = numberArg(0);
      const base = numberArg(1, 10);
      if (typeof value !== "number") return value;
      if (typeof base !== "number") return base;
      if (value <= 0 || base <= 0 || base === 1) return error("#NUM!");
      return num(Math.log(value) / Math.log(base));
    }

    case "ROUND":
    case "ROUNDUP":
    case "ROUNDDOWN":
    case "TRUNC": {
      const value = numberArg(0);
      const digits = numberArg(1, 0);
      if (typeof value !== "number") return value;
      if (typeof digits !== "number") return digits;
      const factor = 10 ** Math.trunc(digits);
      const scaled = Number((Math.abs(value) * factor).toPrecision(15));
      const rounded =
        name === "ROUND"
          ? Math.round(scaled)
          : name === "ROUNDUP"
            ? Math.ceil(scaled)
            : Math.floor(scaled);
      return num((Math.sign(value) * rounded) / factor);
    }

    case "FLOOR":
    case "CEILING":
    case "MROUND": {
      const value = numberArg(0);
      const step = numberArg(1, name === "MROUND" ? undefined : 1);
      if (typeof value !== "number") return value;
      if (typeof step !== "number") return step;
      if (step === 0) return num(0);
      const ratio = Number((value / step).toPrecision(15));
      const multiple =
        name === "FLOOR" ? Math.floor(ratio) : name === "CEILING" ? Math.ceil(ratio) : Math.round(ratio);
      return num(multiple * step);
    }

    case "MOD":
    case "QUOTIENT":
    case "POWER": {
      const a = numberArg(0);
      const b = numberArg(1);
      if (typeof a !== "number") return a;
      if (typeof b !== "number") return b;
      if (name === "POWER") return num(a ** b);
      if (b === 0) return error("#DIV/0!");
      if (name === "QUOTIENT") return num(Math.trunc(a / b));
      return num(a - b * Math.floor(a / b));
    }

    case "PI":
      return num(Math.PI);

    case "RAND":
      return num(Math.random());

    case "RANDBETWEEN": {
      const low = numberArg(0);
      const high = numberArg(1);
      if (typeof low !== "number") return low;
      if (typeof high !== "number") return high;
      const a = Math.ceil(low);
      const b = Math.floor(high);
      if (b < a) return error("#NUM!");
      return num(a + Math.floor(Math.random() * (b - a + 1)));
    }

    case "LARGE":
    case "SMALL": {
      const numbers = numericArgs([asRange(args[0])]);
      if (!Array.isArray(numbers)) return numbers;
      const k = numberArg(1);
      if (typeof k !== "number") return k;
      const sorted = [...numbers].sort((a, b) => (name === "LARGE" ? b - a : a - b));
      const index = Math.trunc(k) - 1;
      return index >= 0 && index < sorted.length ? num(sorted[index]) : error("#NUM!");
    }

    case "RANK":
    case "RANK.EQ": {
      const value = numberArg(0);
      if (typeof value !== "number") return value;
      const numbers = numericArgs([asRange(args[1])]);
      if (!Array.isArray(numbers)) return numbers;
      const ascending = args[2] !== undefined && truthy(arg(2)) === true;
      if (!numbers.includes(value)) return error("#N/A");
      return num(1 + numbers.filter((n) => (ascending ? n < value : n > value)).length);
    }

    case "STDEV":
    case "STDEV.S":
    case "STDEV.P":
    case "VAR":
    case "VAR.S":
    case "VAR.P": {
      const numbers = numericArgs(args);
      if (!Array.isArray(numbers)) return numbers;
      const variance = stats(numbers, !name.endsWith(".P"));
      if (typeof variance !== "number") return variance;
      return num(name.startsWith("STDEV") ? Math.sqrt(variance) : variance);
    }

    case "SUMPRODUCT": {
      if (args.length === 0) return error("#N/A");
      const ranges = args.map(asRange);
      const length = ranges[0].length;
      if (ranges.some((range) => range.length !== length)) return error("#VALUE!");
      let total = 0;
      for (let i = 0; i < length; i += 1) {
        let product = 1;
        for (const range of ranges) {
          const cell = range[i] ?? EMPTY;
          if (isError(cell)) return cell;
          product *= cell.type === "number" ? cell.value : cell.type === "boolean" ? Number(cell.value) : 0;
        }
        total += product;
      }
      return num(total);
    }

    case "SUMSQ": {
      const numbers = numericArgs(args);
      if (!Array.isArray(numbers)) return numbers;
      return num(numbers.reduce((sum, value) => sum + value * value, 0));
    }

    // ---- Conditional aggregates ----
    case "SUMIF":
    case "AVERAGEIF": {
      const range = asRange(args[0]);
      const criterion = arg(1);
      if (isError(criterion)) return criterion;
      const target = args[2] === undefined ? range : asRange(args[2]);
      const test = criteriaMatcher(criterion);
      const indexes = range.map((cell, index) => (test(cell) ? index : -1)).filter((index) => index >= 0);
      const numbers = numbersAt(target, indexes);
      if (name === "SUMIF") return num(numbers.reduce((a, b) => a + b, 0));
      return numbers.length ? num(numbers.reduce((a, b) => a + b, 0) / numbers.length) : error("#DIV/0!");
    }

    case "COUNTIF": {
      const range = asRange(args[0]);
      const criterion = arg(1);
      if (isError(criterion)) return criterion;
      const test = criteriaMatcher(criterion);
      return num(range.filter(test).length);
    }

    case "SUMIFS":
    case "AVERAGEIFS":
    case "MAXIFS":
    case "MINIFS": {
      const target = asRange(args[0]);
      const indexes = matchingIndexes(args.slice(1), target.length);
      if (!Array.isArray(indexes)) return indexes;
      const numbers = numbersAt(target, indexes);
      switch (name) {
        case "SUMIFS":
          return num(numbers.reduce((a, b) => a + b, 0));
        case "AVERAGEIFS":
          return numbers.length ? num(numbers.reduce((a, b) => a + b, 0) / numbers.length) : error("#DIV/0!");
        case "MAXIFS":
          return num(numbers.length ? Math.max(...numbers) : 0);
        default:
          return num(numbers.length ? Math.min(...numbers) : 0);
      }
    }

    case "COUNTIFS": {
      const length = asRange(args[0]).length;
      const indexes = matchingIndexes(args, length);
      if (!Array.isArray(indexes)) return indexes;
      return num(indexes.length);
    }

    // ---- Logic ----
    case "IF": {
      const condition = arg(0);
      const flag = truthy(condition);
      if (typeof flag !== "boolean") return flag;
      if (flag) return args[1] === undefined ? bool(true) : arg(1);
      return args[2] === undefined ? bool(false) : arg(2);
    }

    case "IFS": {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const flag = truthy(arg(i));
        if (typeof flag !== "boolean") return flag;
        if (flag) return arg(i + 1);
      }
      return error("#N/A");
    }

    case "IFERROR":
      return isError(arg(0)) ? arg(1) : arg(0);

    case "IFNA": {
      const value = arg(0);
      return value.type === "error" && value.message === "#N/A" ? arg(1) : value;
    }

    case "AND":
    case "OR":
    case "XOR": {
      const flags: boolean[] = [];
      for (const cell of flatten(args)) {
        if (cell.type === "empty") continue;
        const flag = truthy(cell);
        if (typeof flag !== "boolean") {
          if (cell.type === "text") continue;
          return flag;
        }
        flags.push(flag);
      }
      if (flags.length === 0) return error("#VALUE!");
      if (name === "AND") return bool(flags.every(Boolean));
      if (name === "OR") return bool(flags.some(Boolean));
      return bool(flags.filter(Boolean).length % 2 === 1);
    }

    case "NOT": {
      const flag = truthy(arg(0));
      return typeof flag === "boolean" ? bool(!flag) : flag;
    }

    case "TRUE":
      return bool(true);
    case "FALSE":
      return bool(false);

    case "SWITCH": {
      const value = arg(0);
      if (isError(value)) return value;
      let i = 1;
      for (; i + 1 < args.length; i += 2) {
        if (compareValues(value, arg(i)) === 0) return arg(i + 1);
      }
      return i < args.length ? arg(i) : error("#N/A");
    }

    case "CHOOSE": {
      const index = numberArg(0);
      if (typeof index !== "number") return index;
      const pick = Math.trunc(index);
      return pick >= 1 && pick < args.length ? arg(pick) : error("#VALUE!");
    }

    // ---- Information ----
    case "ISBLANK":
      return bool(arg(0).type === "empty");
    case "ISNUMBER":
      return bool(arg(0).type === "number");
    case "ISTEXT":
      return bool(arg(0).type === "text");
    case "ISLOGICAL":
      return bool(arg(0).type === "boolean");
    case "ISERROR":
    case "ISERR":
      return bool(isError(arg(0)));
    case "ISNA": {
      const value = arg(0);
      return bool(value.type === "error" && value.message === "#N/A");
    }
    case "ISEVEN":
    case "ISODD": {
      const value = numberArg(0);
      if (typeof value !== "number") return value;
      const even = Math.trunc(value) % 2 === 0;
      return bool(name === "ISEVEN" ? even : !even);
    }
    case "NA":
      return error("#N/A");
    case "N": {
      const value = arg(0);
      return value.type === "number" ? value : value.type === "boolean" ? num(Number(value.value)) : num(0);
    }
    case "ROW":
      return num(context.row + 1);
    case "COLUMN":
      return num(context.col + 1);
    case "ROWS":
      return num(asRange(args[0]).rows);
    case "COLUMNS":
      return num(asRange(args[0]).cols);

    // ---- Lookup ----
    case "VLOOKUP":
    case "HLOOKUP": {
      const target = arg(0);
      if (isError(target)) return target;
      const table = asRange(args[1]);
      const index = numberArg(2);
      if (typeof index !== "number") return index;
      const approximate = args[3] === undefined ? true : truthy(arg(3)) === true;
      const pick = Math.trunc(index) - 1;
      if (name === "VLOOKUP") {
        if (pick < 0 || pick >= table.cols) return error("#REF!");
        const found = findIndex(target, column(table, 0), approximate ? 1 : 0);
        return found < 0 ? error("#N/A") : (table[found * table.cols + pick] ?? EMPTY);
      }
      if (pick < 0 || pick >= table.rows) return error("#REF!");
      const found = findIndex(target, row(table, 0), approximate ? 1 : 0);
      return found < 0 ? error("#N/A") : (table[pick * table.cols + found] ?? EMPTY);
    }

    case "XLOOKUP": {
      const target = arg(0);
      if (isError(target)) return target;
      const lookIn = asRange(args[1]);
      const results = asRange(args[2]);
      const mode = numberArg(4, 0);
      if (typeof mode !== "number") return mode;
      const reverse = numberArg(5, 1);
      if (typeof reverse !== "number") return reverse;
      const cells = lookIn.rows === 1 ? row(lookIn, 0) : column(lookIn, 0);
      let found = -1;
      if (mode === 0 || mode === 2) {
        const ordered = reverse < 0 ? [...cells].reverse() : cells;
        const index = findIndex(target, ordered, 0);
        found = index < 0 ? -1 : reverse < 0 ? cells.length - 1 - index : index;
      } else {
        // -1: exact or next smaller, 1: exact or next larger (any order).
        let best = -1;
        cells.forEach((cell, index) => {
          if (cell.type === "empty" || cell.type === "error") return;
          const order = compareValues(cell, target);
          if (order === 0 && best < 0) best = index;
          else if (order === 0) return;
          else if (mode < 0 && order < 0 && (best < 0 || compareValues(cell, cells[best]) > 0)) best = index;
          else if (mode > 0 && order > 0 && (best < 0 || compareValues(cell, cells[best]) < 0)) best = index;
        });
        found = best;
      }
      if (found < 0) return args[3] === undefined ? error("#N/A") : arg(3);
      if (lookIn.rows === 1) return results.rows > 1 ? (results[found] ?? EMPTY) : (results[found] ?? EMPTY);
      return results[found * results.cols] ?? EMPTY;
    }

    case "MATCH": {
      const target = arg(0);
      if (isError(target)) return target;
      const range = asRange(args[1]);
      const mode = numberArg(2, 1);
      if (typeof mode !== "number") return mode;
      const cells = range.rows === 1 ? row(range, 0) : column(range, 0);
      const found = findIndex(target, cells, Math.sign(mode));
      return found < 0 ? error("#N/A") : num(found + 1);
    }

    case "INDEX": {
      const range = asRange(args[0]);
      const rowIndex = numberArg(1, 0);
      const colIndex = numberArg(2, 0);
      if (typeof rowIndex !== "number") return rowIndex;
      if (typeof colIndex !== "number") return colIndex;
      let r = Math.trunc(rowIndex);
      let c = Math.trunc(colIndex);
      // One-dimensional ranges take a single position in either argument.
      if (range.rows === 1 && args[2] === undefined) {
        c = r;
        r = 1;
      }
      if (r < 0 || c < 0 || r > range.rows || c > range.cols) return error("#REF!");
      return range[(Math.max(r, 1) - 1) * range.cols + (Math.max(c, 1) - 1)] ?? EMPTY;
    }

    // ---- Text ----
    case "CONCAT":
    case "CONCATENATE":
      return text(flatten(args).map(toText).join(""));

    case "TEXTJOIN": {
      const separator = textArg(0);
      const skipEmpty = truthy(arg(1)) === true;
      const parts = flatten(args.slice(2))
        .map(toText)
        .filter((part) => !skipEmpty || part !== "");
      return text(parts.join(separator));
    }

    case "LEN":
      return num(textArg(0).length);
    case "UPPER":
      return text(textArg(0).toUpperCase());
    case "LOWER":
      return text(textArg(0).toLowerCase());
    case "PROPER":
      return text(textArg(0).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase()));
    case "TRIM":
      return text(textArg(0).trim().replace(/\s+/g, " "));

    case "LEFT":
    case "RIGHT": {
      const count = numberArg(1, 1);
      if (typeof count !== "number") return count;
      if (count < 0) return error("#VALUE!");
      const value = textArg(0);
      return text(name === "LEFT" ? value.slice(0, count) : count === 0 ? "" : value.slice(-count));
    }

    case "MID": {
      const start = numberArg(1);
      const count = numberArg(2);
      if (typeof start !== "number") return start;
      if (typeof count !== "number") return count;
      if (start < 1 || count < 0) return error("#VALUE!");
      return text(textArg(0).substr(start - 1, count));
    }

    case "FIND":
    case "SEARCH": {
      const needle = textArg(0);
      const haystack = textArg(1);
      const start = numberArg(2, 1);
      if (typeof start !== "number") return start;
      let index: number;
      if (name === "FIND") index = haystack.indexOf(needle, start - 1);
      else if (/[*?]/.test(needle)) {
        const pattern = new RegExp(needle.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]"), "i");
        const match = pattern.exec(haystack.slice(start - 1));
        index = match ? match.index + start - 1 : -1;
      } else index = haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1);
      return index < 0 ? error("#VALUE!") : num(index + 1);
    }

    case "SUBSTITUTE": {
      const value = textArg(0);
      const from = textArg(1);
      const to = textArg(2);
      if (from === "") return text(value);
      if (args[3] === undefined) return text(value.split(from).join(to));
      const nth = numberArg(3);
      if (typeof nth !== "number") return nth;
      let seen = 0;
      return text(value.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (match) => (++seen === nth ? to : match)));
    }

    case "REPLACE": {
      const start = numberArg(1);
      const count = numberArg(2);
      if (typeof start !== "number") return start;
      if (typeof count !== "number") return count;
      const value = textArg(0);
      return text(value.slice(0, start - 1) + textArg(3) + value.slice(start - 1 + count));
    }

    case "REPT": {
      const count = numberArg(1);
      if (typeof count !== "number") return count;
      return count < 0 || count > 10000 ? error("#VALUE!") : text(textArg(0).repeat(Math.trunc(count)));
    }

    case "EXACT":
      return bool(textArg(0) === textArg(1));

    case "VALUE": {
      const value = arg(0);
      if (value.type === "number") return value;
      const numeric = toNumber(value);
      return typeof numeric === "number" ? num(numeric) : numeric;
    }

    case "TEXT": {
      const format = arg(1);
      if (isError(format)) return format;
      return textFunction(arg(0), toText(format));
    }

    // ---- Dates ----
    case "TODAY":
      return text(isoDate(todayCalendar()));

    case "NOW": {
      const now = new Date();
      return text(`${isoDate(todayCalendar())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    }

    case "DATE": {
      const year = numberArg(0);
      const month = numberArg(1);
      const day = numberArg(2);
      const bad = firstError(
        ...[year, month, day].filter((value): value is CellResult => typeof value !== "number"),
      );
      if (bad) return bad;
      const ms = Date.UTC(Math.trunc(year as number), Math.trunc(month as number) - 1, Math.trunc(day as number));
      if (!Number.isFinite(ms)) return error("#NUM!");
      return text(isoDate(calendarFromUtc(ms)));
    }

    case "DATEVALUE": {
      const date = toCalendarDate(arg(0));
      return isCalendarDate(date) ? text(isoDate(date)) : date;
    }

    case "YEAR":
    case "MONTH":
    case "DAY": {
      const date = toCalendarDate(arg(0));
      if (!isCalendarDate(date)) return date;
      return num(name === "YEAR" ? date.year : name === "MONTH" ? date.month : date.day);
    }

    case "WEEKDAY": {
      const date = toCalendarDate(arg(0));
      if (!isCalendarDate(date)) return date;
      const typeArg = numberArg(1, 1);
      if (typeof typeArg !== "number") return typeArg;
      const value = weekdayNumber(date, Math.trunc(typeArg) || 1);
      return typeof value === "number" ? num(value) : value;
    }

    case "WEEKNUM":
    case "ISOWEEKNUM": {
      const date = toCalendarDate(arg(0));
      if (!isCalendarDate(date)) return date;
      if (name === "ISOWEEKNUM") return num(isoWeek(date));
      const typeArg = numberArg(1, 1);
      if (typeof typeArg !== "number") return typeArg;
      const start = Math.trunc(typeArg) === 2 ? 1 : 0;
      const jan1 = { year: date.year, month: 1, day: 1 };
      const offset = (weekdayIndex(jan1) - start + 7) % 7;
      const dayOfYear = calendarToSerial(date) - calendarToSerial(jan1);
      return num(Math.floor((dayOfYear + offset) / 7) + 1);
    }

    case "DAYS": {
      const end = toCalendarDate(arg(0));
      if (!isCalendarDate(end)) return end;
      const start = toCalendarDate(arg(1));
      if (!isCalendarDate(start)) return start;
      return num(calendarToSerial(end) - calendarToSerial(start));
    }

    case "EDATE":
    case "EOMONTH": {
      const date = toCalendarDate(arg(0));
      if (!isCalendarDate(date)) return date;
      const months = numberArg(1);
      if (typeof months !== "number") return months;
      return text(isoDate(name === "EDATE" ? addMonths(date, Math.trunc(months)) : endOfMonth(date, Math.trunc(months))));
    }

    case "DATEDIF": {
      const start = toCalendarDate(arg(0));
      if (!isCalendarDate(start)) return start;
      const end = toCalendarDate(arg(1));
      if (!isCalendarDate(end)) return end;
      const unit = textArg(2).toUpperCase();
      const days = calendarToSerial(end) - calendarToSerial(start);
      if (days < 0) return error("#NUM!");
      let months = (end.year - start.year) * 12 + (end.month - start.month);
      if (end.day < start.day) months -= 1;
      switch (unit) {
        case "D":
          return num(days);
        case "M":
          return num(months);
        case "Y":
          return num(Math.floor(months / 12));
        case "YM":
          return num(months % 12);
        case "MD": {
          const anchor = addMonths(start, months);
          return num(calendarToSerial(end) - calendarToSerial(anchor));
        }
        case "YD": {
          const anchor = addMonths(start, Math.floor(months / 12) * 12);
          return num(calendarToSerial(end) - calendarToSerial(anchor));
        }
        default:
          return error("#NUM!");
      }
    }

    case "NETWORKDAYS":
    case "WORKDAY": {
      const start = toCalendarDate(arg(0));
      if (!isCalendarDate(start)) return start;
      const holidays = new Set(dateSerials(args[2] === undefined ? [] : [args[2]]));
      const isWorkday = (serial: number) => {
        const weekday = weekdayIndex(serialToCalendar(serial));
        return weekday !== 0 && weekday !== 6 && !holidays.has(serial);
      };
      const from = calendarToSerial(start);
      if (name === "NETWORKDAYS") {
        const end = toCalendarDate(arg(1));
        if (!isCalendarDate(end)) return end;
        const to = calendarToSerial(end);
        const step = to >= from ? 1 : -1;
        if (Math.abs(to - from) > 366 * 200) return error("#NUM!");
        let count = 0;
        for (let serial = from; step > 0 ? serial <= to : serial >= to; serial += step) {
          if (isWorkday(serial)) count += 1;
        }
        return num(count * step);
      }
      const days = numberArg(1);
      if (typeof days !== "number") return days;
      if (Math.abs(days) > 100000) return error("#NUM!");
      let remaining = Math.trunc(Math.abs(days));
      const step = days >= 0 ? 1 : -1;
      let serial = from;
      while (remaining > 0) {
        serial += step;
        if (isWorkday(serial)) remaining -= 1;
      }
      return text(serialToIso(serial));
    }

    default:
      return error("#NAME?");
  }
}

/** One line of help per function: shown while typing a formula and in the function menu. */
export const SHEET_FUNCTION_HELP: Record<string, { signature: string; summary: string; group: string }> = {
  SUM: { signature: "SUM(value1, [value2, …])", summary: "Adds numbers", group: "Math" },
  AVERAGE: { signature: "AVERAGE(value1, [value2, …])", summary: "Average of numbers", group: "Math" },
  MIN: { signature: "MIN(value1, [value2, …])", summary: "Smallest number or earliest date", group: "Math" },
  MAX: { signature: "MAX(value1, [value2, …])", summary: "Largest number or latest date", group: "Math" },
  MEDIAN: { signature: "MEDIAN(value1, [value2, …])", summary: "Middle value", group: "Math" },
  COUNT: { signature: "COUNT(value1, [value2, …])", summary: "Counts numbers", group: "Math" },
  COUNTA: { signature: "COUNTA(value1, [value2, …])", summary: "Counts filled cells", group: "Math" },
  COUNTBLANK: { signature: "COUNTBLANK(range)", summary: "Counts empty cells", group: "Math" },
  PRODUCT: { signature: "PRODUCT(value1, [value2, …])", summary: "Multiplies numbers", group: "Math" },
  ROUND: { signature: "ROUND(value, [places])", summary: "Rounds to a number of decimals", group: "Math" },
  ROUNDUP: { signature: "ROUNDUP(value, [places])", summary: "Rounds away from zero", group: "Math" },
  ROUNDDOWN: { signature: "ROUNDDOWN(value, [places])", summary: "Rounds toward zero", group: "Math" },
  ABS: { signature: "ABS(value)", summary: "Absolute value", group: "Math" },
  MOD: { signature: "MOD(dividend, divisor)", summary: "Remainder after division", group: "Math" },
  INT: { signature: "INT(value)", summary: "Rounds down to a whole number", group: "Math" },
  POWER: { signature: "POWER(base, exponent)", summary: "Raises to a power", group: "Math" },
  SQRT: { signature: "SQRT(value)", summary: "Square root", group: "Math" },
  FLOOR: { signature: "FLOOR(value, [step])", summary: "Rounds down to a multiple", group: "Math" },
  CEILING: { signature: "CEILING(value, [step])", summary: "Rounds up to a multiple", group: "Math" },
  LARGE: { signature: "LARGE(range, k)", summary: "k-th largest number", group: "Math" },
  SMALL: { signature: "SMALL(range, k)", summary: "k-th smallest number", group: "Math" },
  RANK: { signature: "RANK(value, range, [ascending])", summary: "Position of a number in a list", group: "Math" },
  STDEV: { signature: "STDEV(value1, [value2, …])", summary: "Sample standard deviation", group: "Math" },
  SUMPRODUCT: { signature: "SUMPRODUCT(range1, [range2, …])", summary: "Sum of row-by-row products", group: "Math" },
  SUMIF: { signature: "SUMIF(range, criteria, [sum_range])", summary: "Adds cells that match, e.g. \"Food\" or \">100\"", group: "Conditional" },
  SUMIFS: { signature: "SUMIFS(sum_range, range1, criteria1, …)", summary: "Adds cells matching every condition", group: "Conditional" },
  COUNTIF: { signature: "COUNTIF(range, criteria)", summary: "Counts cells that match", group: "Conditional" },
  COUNTIFS: { signature: "COUNTIFS(range1, criteria1, …)", summary: "Counts rows matching every condition", group: "Conditional" },
  AVERAGEIF: { signature: "AVERAGEIF(range, criteria, [average_range])", summary: "Average of matching cells", group: "Conditional" },
  AVERAGEIFS: { signature: "AVERAGEIFS(average_range, range1, criteria1, …)", summary: "Average of rows matching every condition", group: "Conditional" },
  MAXIFS: { signature: "MAXIFS(max_range, range1, criteria1, …)", summary: "Largest matching value", group: "Conditional" },
  MINIFS: { signature: "MINIFS(min_range, range1, criteria1, …)", summary: "Smallest matching value", group: "Conditional" },
  IF: { signature: "IF(test, if_true, [if_false])", summary: "Picks a value by a test", group: "Logic" },
  IFS: { signature: "IFS(test1, value1, [test2, value2, …])", summary: "First value whose test is true", group: "Logic" },
  IFERROR: { signature: "IFERROR(value, if_error)", summary: "Replaces an error", group: "Logic" },
  IFNA: { signature: "IFNA(value, if_na)", summary: "Replaces #N/A", group: "Logic" },
  SWITCH: { signature: "SWITCH(value, case1, result1, …, [default])", summary: "Matches a value against cases", group: "Logic" },
  CHOOSE: { signature: "CHOOSE(index, value1, value2, …)", summary: "Picks by position", group: "Logic" },
  AND: { signature: "AND(test1, [test2, …])", summary: "True when all are true", group: "Logic" },
  OR: { signature: "OR(test1, [test2, …])", summary: "True when any is true", group: "Logic" },
  NOT: { signature: "NOT(test)", summary: "Flips true and false", group: "Logic" },
  ISBLANK: { signature: "ISBLANK(cell)", summary: "True for an empty cell", group: "Logic" },
  ISNUMBER: { signature: "ISNUMBER(value)", summary: "True for a number", group: "Logic" },
  ISTEXT: { signature: "ISTEXT(value)", summary: "True for text", group: "Logic" },
  ISERROR: { signature: "ISERROR(value)", summary: "True for any error", group: "Logic" },
  VLOOKUP: { signature: "VLOOKUP(value, table, column, [approximate])", summary: "Looks down the first column", group: "Lookup" },
  HLOOKUP: { signature: "HLOOKUP(value, table, row, [approximate])", summary: "Looks across the first row", group: "Lookup" },
  XLOOKUP: { signature: "XLOOKUP(value, lookup_range, result_range, [if_not_found])", summary: "Finds a value and returns its partner", group: "Lookup" },
  INDEX: { signature: "INDEX(range, row, [column])", summary: "Cell at a position", group: "Lookup" },
  MATCH: { signature: "MATCH(value, range, [match_type])", summary: "Position of a value (0 = exact)", group: "Lookup" },
  ROWS: { signature: "ROWS(range)", summary: "Number of rows", group: "Lookup" },
  COLUMNS: { signature: "COLUMNS(range)", summary: "Number of columns", group: "Lookup" },
  CONCAT: { signature: "CONCAT(text1, [text2, …])", summary: "Joins text", group: "Text" },
  TEXTJOIN: { signature: "TEXTJOIN(separator, skip_empty, text1, …)", summary: "Joins text with a separator", group: "Text" },
  LEFT: { signature: "LEFT(text, [count])", summary: "First characters", group: "Text" },
  RIGHT: { signature: "RIGHT(text, [count])", summary: "Last characters", group: "Text" },
  MID: { signature: "MID(text, start, count)", summary: "Characters from the middle", group: "Text" },
  LEN: { signature: "LEN(text)", summary: "Number of characters", group: "Text" },
  FIND: { signature: "FIND(find, text, [start])", summary: "Position of text (case-sensitive)", group: "Text" },
  SEARCH: { signature: "SEARCH(find, text, [start])", summary: "Position of text (any case, * and ?)", group: "Text" },
  SUBSTITUTE: { signature: "SUBSTITUTE(text, old, new, [which])", summary: "Replaces text", group: "Text" },
  REPLACE: { signature: "REPLACE(text, start, count, new)", summary: "Replaces characters by position", group: "Text" },
  UPPER: { signature: "UPPER(text)", summary: "Upper case", group: "Text" },
  LOWER: { signature: "LOWER(text)", summary: "Lower case", group: "Text" },
  PROPER: { signature: "PROPER(text)", summary: "Capitalizes each word", group: "Text" },
  TRIM: { signature: "TRIM(text)", summary: "Removes extra spaces", group: "Text" },
  TEXT: { signature: "TEXT(value, format)", summary: "Formats a number or date, e.g. \"mmm yyyy\"", group: "Text" },
  VALUE: { signature: "VALUE(text)", summary: "Turns text into a number", group: "Text" },
  TODAY: { signature: "TODAY()", summary: "Today's date", group: "Date" },
  NOW: { signature: "NOW()", summary: "Date and time now", group: "Date" },
  DATE: { signature: "DATE(year, month, day)", summary: "Builds a date", group: "Date" },
  YEAR: { signature: "YEAR(date)", summary: "Year of a date", group: "Date" },
  MONTH: { signature: "MONTH(date)", summary: "Month number of a date", group: "Date" },
  DAY: { signature: "DAY(date)", summary: "Day of the month", group: "Date" },
  WEEKDAY: { signature: "WEEKDAY(date, [type])", summary: "Day of the week as a number", group: "Date" },
  WEEKNUM: { signature: "WEEKNUM(date, [type])", summary: "Week of the year", group: "Date" },
  DAYS: { signature: "DAYS(end, start)", summary: "Days between two dates", group: "Date" },
  DATEDIF: { signature: "DATEDIF(start, end, unit)", summary: "Difference in \"D\", \"M\" or \"Y\"", group: "Date" },
  EDATE: { signature: "EDATE(date, months)", summary: "Same day some months later", group: "Date" },
  EOMONTH: { signature: "EOMONTH(date, months)", summary: "Last day of a month", group: "Date" },
  NETWORKDAYS: { signature: "NETWORKDAYS(start, end, [holidays])", summary: "Working days between dates", group: "Date" },
  WORKDAY: { signature: "WORKDAY(start, days, [holidays])", summary: "Date after some working days", group: "Date" },
};

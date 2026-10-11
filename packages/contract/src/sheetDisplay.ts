import type { SheetCellFormat, SheetNumberFormat } from "./sheet";
import type { SheetColumn, SheetColumnFormat, SheetColumnType, SheetConditionalFormat } from "./sheetTypes";
import { formatDateText, toText, type CellResult } from "./sheetFunctions";
import { compareValues, parseIsoDate, serialToCalendar } from "./sheetValues";
import { parseDateInput, parseNumberInput } from "./sheetCell";

/**
 * How a cell reads on screen, shared by the web grid and the phone so a
 * sheet looks the same everywhere. A cell's own format wins over its
 * column's format, which wins over the column type's default.
 */

/** Currencies people pick most often; any ISO 4217 code or short symbol works. */
export const SHEET_CURRENCY_CHOICES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "LKR",
  "AED",
  "SAR",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "SGD",
  "MYR",
  "PKR",
  "BDT",
] as const;

const symbolCache = new Map<string, Intl.NumberFormat | null>();

function currencyFormatter(code: string, digits: number): Intl.NumberFormat | null {
  const key = `${code}:${digits}`;
  if (symbolCache.has(key)) return symbolCache.get(key)!;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    formatter = null;
  }
  symbolCache.set(key, formatter);
  return formatter;
}

function grouped(value: number, digits?: number) {
  return value.toLocaleString(
    undefined,
    digits == null
      ? { maximumFractionDigits: 10 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  );
}

/** "Rs 1,250.00", "€12.50" or plain "1,250.00" when no currency is set. */
export function formatCurrency(value: number, currency: string | undefined, digits = 2): string {
  const code = currency?.trim();
  if (!code) return grouped(value, digits);
  if (/^[A-Za-z]{3}$/.test(code)) {
    const formatter = currencyFormatter(code.toUpperCase(), digits);
    if (formatter) return formatter.format(value);
  }
  const body = grouped(Math.abs(value), digits);
  return `${value < 0 ? "-" : ""}${code}${/\p{Sc}$/u.test(code) ? "" : " "}${body}`;
}

export function formatNumberValue(
  value: number,
  format: SheetNumberFormat | undefined,
  decimals?: number,
  currency?: string,
): string {
  if (!Number.isFinite(value)) return "#NUM!";
  const digits = decimals ?? (format === "currency" || format === "percent" ? 2 : undefined);
  if (format === "currency") return formatCurrency(value, currency, digits ?? 2);
  if (format === "percent") return `${grouped(value * 100, digits)}%`;
  if (format === "scientific") return value.toExponential(digits ?? 2);
  if (format === "plain") return String(value);
  if (digits != null) return grouped(value, digits);
  return String(Math.round(value * 1e10) / 1e10);
}

/** A YYYY-MM-DD value in a column's date style. */
export function formatDateValue(iso: string, dateFormat: string | undefined): string {
  if (!dateFormat || dateFormat === "yyyy-mm-dd") return iso;
  const date = parseIsoDate(iso);
  return date ? formatDateText(date, dateFormat) : iso;
}

export function resolveSheetNumberFormat(
  type: SheetColumnType | undefined,
  cellFormat?: SheetCellFormat,
): SheetNumberFormat | undefined {
  if (cellFormat?.numberFormat) return cellFormat.numberFormat;
  if (type === "currency") return "currency";
  if (type === "percent") return "percent";
  return undefined;
}

/**
 * The text a cell shows. `raw` is what is stored; `result` is its value after
 * formulas run. Percent columns hold 0.25 for 25%.
 */
export function formatSheetCell(
  result: CellResult,
  column: Pick<SheetColumn, "type" | "format"> | undefined,
  raw: string,
  cellFormat?: SheetCellFormat,
): string {
  const type = column?.type;
  const columnFormat: SheetColumnFormat = column?.format ?? {};
  if (result.type === "error") return result.message;
  if (result.type === "empty") return "";
  if (result.type === "boolean") return result.value ? "TRUE" : "FALSE";
  const decimals = cellFormat?.decimals ?? columnFormat.decimals;
  if (result.type === "number") {
    if (type === "date" && !cellFormat?.numberFormat && raw.trim().startsWith("=")) {
      const date = serialToCalendar(result.value);
      return formatDateText(date, columnFormat.dateFormat ?? "yyyy-mm-dd");
    }
    const kind = resolveSheetNumberFormat(type, cellFormat);
    // A percent column shows 0.25 as 25% but keeps whole numbers typed as-is
    // when they came from a formula that already counts in percent.
    return formatNumberValue(result.value, kind, decimals, columnFormat.currency);
  }
  if (type === "date") return formatDateValue(result.value, columnFormat.dateFormat);
  return toText(result);
}

export type ConditionalStyle = Pick<SheetCellFormat, "fillColor" | "textColor" | "bold">;

function criterion(text: string | undefined): CellResult {
  const value = (text ?? "").trim();
  if (value === "") return { type: "empty" };
  const number = parseNumberInput(value);
  if (number !== null) return { type: "number", value: number };
  const date = parseDateInput(value);
  if (date) return { type: "text", value: date };
  return { type: "text", value };
}

function isBlank(cell: CellResult) {
  return cell.type === "empty" || (cell.type === "text" && cell.value.trim() === "");
}

/**
 * Which cells each rule colours. Earlier rules win when two rules set the same
 * property on a cell. Keys are `${col}:${row}`. Rows above `startRow` (the
 * frozen header or totals rows) are never tested or coloured.
 */
const STATISTICAL = new Set<SheetConditionalFormat["operator"]>(["aboveAverage", "belowAverage", "duplicate"]);

export function conditionalStyles(
  rules: readonly SheetConditionalFormat[] | undefined,
  columns: readonly Pick<SheetColumn, "id">[],
  rowCount: number,
  valueAt: (col: number, row: number) => CellResult,
  startRow = 0,
  /** Total rows: left out of averages and duplicates so a total never skews them. */
  summaryRows?: ReadonlySet<number>,
): Map<string, ConditionalStyle> {
  const styles = new Map<string, ConditionalStyle>();
  if (!rules?.length) return styles;
  const columnCount = columns.length;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    const col = columns.findIndex((column) => column.id === rule.columnId);
    if (col < 0) continue;
    const style: ConditionalStyle = {};
    if (rule.fillColor) style.fillColor = rule.fillColor;
    if (rule.textColor) style.textColor = rule.textColor;
    if (rule.bold) style.bold = true;
    if (!Object.keys(style).length) continue;

    const statistical = STATISTICAL.has(rule.operator);
    const counted = (row: number) => !(statistical && summaryRows?.has(row));
    const values: CellResult[] = [];
    for (let row = startRow; row < rowCount; row += 1) values.push(counted(row) ? valueAt(col, row) : { type: "empty" });
    const test = conditionTest(rule, values);
    for (let row = startRow; row < rowCount; row += 1) {
      if (!counted(row) || !test(values[row - startRow])) continue;
      const from = rule.wholeRow ? 0 : col;
      const to = rule.wholeRow ? columnCount - 1 : col;
      for (let c = from; c <= to; c += 1) {
        const key = `${c}:${row}`;
        styles.set(key, { ...styles.get(key), ...style });
      }
    }
  }
  return styles;
}

function conditionTest(rule: SheetConditionalFormat, values: CellResult[]): (cell: CellResult) => boolean {
  const target = criterion(rule.value);
  const second = criterion(rule.value2);
  const numbers = values.flatMap((cell) => (cell.type === "number" ? [cell.value] : []));
  const average = numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
  const lower = (rule.value ?? "").trim().toLowerCase();
  switch (rule.operator) {
    case "empty":
      return isBlank;
    case "notEmpty":
      return (cell) => !isBlank(cell);
    case "contains":
      return (cell) => lower !== "" && toText(cell).toLowerCase().includes(lower);
    case "notContains":
      return (cell) => lower === "" || !toText(cell).toLowerCase().includes(lower);
    case "aboveAverage":
      return (cell) => numbers.length > 0 && cell.type === "number" && cell.value > average;
    case "belowAverage":
      return (cell) => numbers.length > 0 && cell.type === "number" && cell.value < average;
    case "duplicate": {
      const counts = new Map<string, number>();
      for (const cell of values) {
        if (isBlank(cell)) continue;
        const key = toText(cell).trim().toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return (cell) => !isBlank(cell) && (counts.get(toText(cell).trim().toLowerCase()) ?? 0) > 1;
    }
    default:
      break;
  }
  return (cell) => {
    if (cell.type === "error") return false;
    if (rule.operator === "neq") return isBlank(cell) ? target.type !== "empty" : compareValues(cell, target) !== 0;
    if (isBlank(cell)) return rule.operator === "eq" && target.type === "empty";
    if (target.type === "empty") return false;
    // A number rule never matches words: "pending" is not greater than 100.
    if (target.type === "number" && cell.type !== "number") return false;
    const order = compareValues(cell, target);
    switch (rule.operator) {
      case "gt":
        return order > 0;
      case "gte":
        return order >= 0;
      case "lt":
        return order < 0;
      case "lte":
        return order <= 0;
      case "eq":
        return order === 0;
      case "between": {
        if (second.type === "empty") return false;
        const low = compareValues(target, second) <= 0 ? target : second;
        const high = low === target ? second : target;
        return compareValues(cell, low) >= 0 && compareValues(cell, high) <= 0;
      }
      default:
        return false;
    }
  };
}

/** Plain-language labels for the rule editor. */
export const SHEET_CONDITION_LABELS: Record<SheetConditionalFormat["operator"], string> = {
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  eq: "Equal to",
  neq: "Not equal to",
  between: "Between",
  contains: "Contains",
  notContains: "Does not contain",
  empty: "Is empty",
  notEmpty: "Is not empty",
  aboveAverage: "Above average",
  belowAverage: "Below average",
  duplicate: "Duplicate values",
};

/** Operators that take no value, or two. */
export function conditionValueCount(operator: SheetConditionalFormat["operator"]): 0 | 1 | 2 {
  if (operator === "between") return 2;
  if (["empty", "notEmpty", "aboveAverage", "belowAverage", "duplicate"].includes(operator)) return 0;
  return 1;
}

/**
 * Minimal structural sheet shapes the shared sheet logic needs. The apps keep
 * their own richer row/format types; these are what the pure helpers read.
 */
export type SheetColumnType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "currency"
  | "percent"
  | "formula"
  | "select";

/** Date styles a column can show (models.SheetDateFormats on the server). */
export const SHEET_DATE_FORMATS = [
  "yyyy-mm-dd",
  "d mmm yyyy",
  "d mmm",
  "mmm d, yyyy",
  "dd/mm/yyyy",
  "mm/dd/yyyy",
  "ddd d mmm",
  "mmmm yyyy",
] as const;
export type SheetDateFormat = (typeof SHEET_DATE_FORMATS)[number];

/** How a whole column displays. A cell's own format overrides it. */
export interface SheetColumnFormat {
  /** ISO 4217 code such as "LKR", or a short symbol such as "Rs". */
  currency?: string;
  dateFormat?: SheetDateFormat;
  decimals?: number;
}

export interface SheetColumn {
  id: string;
  name: string;
  width: number;
  type: SheetColumnType;
  /** Dropdown choices of a select column; absent for other types. */
  options?: string[];
  format?: SheetColumnFormat;
  /** Hidden columns keep their data but are not drawn. */
  hidden?: boolean;
}

export const SHEET_CONDITION_OPERATORS = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "between",
  "contains",
  "notContains",
  "empty",
  "notEmpty",
  "aboveAverage",
  "belowAverage",
  "duplicate",
] as const;
export type SheetConditionOperator = (typeof SHEET_CONDITION_OPERATORS)[number];

/** Styles the cells of one column (or their whole rows) that pass a test. */
export interface SheetConditionalFormat {
  id: string;
  columnId: string;
  operator: SheetConditionOperator;
  value?: string;
  value2?: string;
  fillColor?: string;
  textColor?: string;
  bold?: boolean;
  wholeRow?: boolean;
}

export interface SheetRow {
  id: string;
  cells: Record<string, string>;
}

export interface SheetMerge {
  startCol: number;
  startRow: number;
  colSpan: number;
  rowSpan: number;
}

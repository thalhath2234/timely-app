/**
 * A sheet's cells by column name, for `@Cells` in described cards and live
 * blocks (genuiBoard.ts). A tab is read the way the card workshop first picks
 * it (`suggestSheetPick`): its used block, worked out with the sheet's own
 * formula engine, names in the first row when the row below holds numbers,
 * and rows of totals left out. A column answers to its own name,
 * the name typed above it and its letter. The API lists the same names to
 * the model (`cellsBriefs`, through sheetEngine.ts), so a program only names
 * columns the apps find.
 */
import { readPick, sheetTabs, suggestSheetPick, type PickCell } from "./dashboardFiles";
import type { Sheet, SheetTab } from "./sheet";
import { columnIndexToLetter } from "./sheetRefs";
import type { SheetColumn } from "./sheetTypes";

export interface CellsColumn {
  /** What the person sees over the column: its own name, the name in the first row, or its letter. */
  name: string;
  /** Lower-case names it answers to. */
  names: string[];
  /** Most of its filled cells hold numbers. */
  numbers: boolean;
  column: SheetColumn;
}

export interface CellsTable {
  columns: CellsColumn[];
  /** The rows under the names, without a totals row; blank rows are left out. */
  rows: PickCell[][];
  /** The column that names each row when a program asks for none: the first, when it holds text; else -1. */
  labelCol: number;
}

export const nameKey = (text: string) => text.trim().toLowerCase();

/** A sheet's tab by name, in any case; the first tab when no name is given. Null when no tab has the name. */
export function tabByName(sheet: Sheet, name: string | undefined): SheetTab | null {
  const tabs = sheetTabs(sheet);
  if (!name?.trim()) return tabs[0] ?? null;
  return tabs.find((tab) => nameKey(tab.name) === nameKey(name)) ?? null;
}

const RANGE = /\$?[A-Z]{1,3}\$?\d*:\$?[A-Z]{1,3}\$?\d*/i;
/** What a typed totals row is called: "Year total", "Subtotal", "Monthly average". */
const TOTALS_NAME = /\b(sub)?totals?\b|\baverages?\b/i;

/**
 * A row of totals, wherever it sits (the built-in expenses tabs keep theirs
 * on top): at least one formula works over a range, and either nothing is
 * typed or the first typed cell names the row a total or an average (the
 * yearly Summary tab's "Year total" and "Monthly average"). Read as an
 * entry, it would count every entry twice.
 */
function summaryRow(row: PickCell[]): boolean {
  const filled = row.filter((cell) => cell.raw.trim() !== "");
  if (!filled.some((cell) => cell.formula && RANGE.test(cell.raw))) return false;
  const typed = filled.find((cell) => !cell.formula);
  return !typed || TOTALS_NAME.test(typed.text);
}

/** A tab's cells by column, worked out; null when the tab holds nothing. */
export function cellsTable(sheet: Sheet, tab: SheetTab): CellsTable | null {
  const pick = suggestSheetPick(sheet, tab.id || undefined);
  const read = readPick(sheet, { ...pick, view: "table" });
  if (!read || read.grid.length === 0) return null;
  const letters = read.indexes.map((index) => columnIndexToLetter(index));
  const own = read.columns.map((column, i) => {
    const name = column.name?.trim() ?? "";
    return name && name !== letters[i] ? name : "";
  });
  // Columns that all have names of their own hold values from the first row.
  const head = pick.headers && own.some((name) => !name) ? read.grid[0] : null;
  const rows = (head ? read.grid.slice(1) : read.grid).filter((row) => row.some((cell) => cell.text.trim() !== "") && !summaryRow(row));
  if (rows.length === 0) return null;
  const columns = read.columns.map((column, i) => {
    const above = head?.[i]?.text.trim() ?? "";
    const filled = rows.map((row) => row[i]).filter((cell) => cell && cell.text.trim() !== "");
    const numeric = filled.filter((cell) => cell.number !== null).length;
    return {
      name: own[i] || above || letters[i],
      names: [...new Set([own[i], above, letters[i]].filter(Boolean).map(nameKey))],
      numbers: filled.length > 0 && numeric * 2 >= filled.length,
      column,
    };
  });
  const labelCol = columns.length > 1 && !columns[0].numbers && rows.some((row) => row[0]?.text.trim()) ? 0 : -1;
  return { columns, rows, labelCol };
}

/** The column a name means, or -1. */
export function columnByName(table: CellsTable, name: string): number {
  const wanted = nameKey(name);
  return table.columns.findIndex((column) => column.names.includes(wanted));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** Short month and weekday names to the full ones: "oct", "sept", "tues". */
const FULL_NAMES = new Map<string, string>([
  ...[...MONTHS, ...WEEKDAYS].map((name) => [name.slice(0, 3), name] as [string, string]),
  ["sept", "september"],
  ["tues", "tuesday"],
  ["weds", "wednesday"],
  ["thur", "thursday"],
  ["thurs", "thursday"],
]);

/** A value as `is` compares it: in any case, spaces evened out, a closing full stop dropped, month and weekday names in full. */
function valueKey(text: string): string {
  const key = nameKey(text).replace(/\s+/g, " ").replace(/\.$/, "");
  return FULL_NAMES.get(key) ?? key;
}

const plainNumber = (text: string) => (/^-?[\d,]*\.?\d+$/.test(text.trim()) ? Number(text.trim().replace(/,/g, "")) : null);

/**
 * Whether a cell holds what a `@Cells` call's `is` asks for: the same text
 * in any case ("Oct" for "October" too), or the same number however the
 * cell shows it ("1200" for "Rs 1,200.00").
 */
export function cellIs(wanted: string): (cell: PickCell | undefined) => boolean {
  const key = valueKey(wanted);
  const number = plainNumber(wanted);
  return (cell) => !!cell && cell.text.trim() !== "" && (valueKey(cell.text) === key || (number !== null && cell.number === number));
}

/** The different values a column holds, as the sheet shows them, in row order. */
export function columnValues(table: CellsTable, col: number): string[] {
  const seen = new Map<string, string>();
  for (const row of table.rows) {
    const text = row[col]?.text.trim() ?? "";
    if (text && !seen.has(valueKey(text))) seen.set(valueKey(text), text);
  }
  return [...seen.values()];
}

/** Edits from one word to the other (short words: these are cell values). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length];
}

/**
 * The value meant by one that matches nothing: "Groceries" for "Grocery",
 * "Dining out" for "Dining". One starts the other, or they are a few
 * letters apart. Empty when nothing is that close.
 */
export function closestValue(values: string[], wanted: string): string {
  const key = valueKey(wanted);
  if (key.length < 3) return "";
  let best = "";
  let bestScore = Infinity;
  for (const value of values) {
    const other = valueKey(value);
    const score = other.startsWith(key) || key.startsWith(other) ? 0.5 : distance(key, other);
    if (score < bestScore && score <= Math.min(3, Math.ceil(key.length / 3))) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

export interface CellsBrief {
  name: string;
  rows: number;
  /** values: what a column of text holds, when it holds a few short ones (months, categories), so `is` names one. */
  columns: { name: string; numbers: boolean; values?: string[] }[];
}

const BRIEF_TABS = 8;
const BRIEF_COLUMNS = 16;
const BRIEF_VALUES = 20;
const BRIEF_VALUE_LENGTH = 40;

/**
 * The tabs of a sheet that hold something, with the column names a program
 * can use and the values `is` can match, for the model's instructions. Empty
 * tabs are left out before the cap, so October's entries in a yearly
 * workbook still reach the model while November and December wait empty.
 */
export function cellsBrief(sheet: Sheet): CellsBrief[] {
  const briefs: CellsBrief[] = [];
  for (const tab of sheetTabs(sheet)) {
    if (briefs.length === BRIEF_TABS) break;
    const table = cellsTable(sheet, tab);
    if (!table) continue;
    briefs.push({
      name: tab.name,
      rows: table.rows.length,
      columns: table.columns.slice(0, BRIEF_COLUMNS).map((column, i) => {
        const values = column.numbers ? [] : columnValues(table, i);
        // Notes and free text say nothing a program could match.
        const few = values.length > 0 && values.length <= BRIEF_VALUES && values.every((value) => value.length <= BRIEF_VALUE_LENGTH);
        return few ? { name: column.name, numbers: column.numbers, values } : { name: column.name, numbers: column.numbers };
      }),
    });
  }
  return briefs;
}

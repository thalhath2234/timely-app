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

/**
 * A row of totals, wherever it sits (the built-in expenses tabs keep theirs
 * on top): nothing typed, only formulas, and at least one adds up a range.
 * Read as an entry, it would count every entry twice.
 */
function summaryRow(row: PickCell[]): boolean {
  const filled = row.filter((cell) => cell.raw.trim() !== "");
  return filled.length > 0 && filled.every((cell) => cell.formula) && filled.some((cell) => RANGE.test(cell.raw));
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

export interface CellsBrief {
  name: string;
  rows: number;
  columns: { name: string; numbers: boolean }[];
}

const BRIEF_TABS = 8;
const BRIEF_COLUMNS = 16;

/** Each tab of a sheet with the column names a program can use, for the model's instructions. */
export function cellsBrief(sheet: Sheet): CellsBrief[] {
  return sheetTabs(sheet)
    .slice(0, BRIEF_TABS)
    .map((tab) => {
      const table = cellsTable(sheet, tab);
      return {
        name: tab.name,
        rows: table?.rows.length ?? 0,
        columns: (table?.columns ?? []).slice(0, BRIEF_COLUMNS).map((column) => ({ name: column.name, numbers: column.numbers })),
      };
    });
}

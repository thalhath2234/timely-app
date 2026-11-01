// Package self-import: Node strip-types cannot resolve an extensionless relative value import.
import { columnIndexToLetter } from "@timely/contract/sheetFormula";
import { normalizeTypedCell } from "@timely/contract/sheetCell";
import type { SheetColumn, SheetRow } from "./sheetTypes";
import { MAX_GRID_COLUMNS, MAX_GRID_ROWS } from "@timely/contract/sheetOps";

/** Id generators differ per platform, so callers supply them. */
export interface SheetIdFactory {
  newColumnId: () => string;
  newRowId: () => string;
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * The sheet as CSV for other tools: each cell is what the grid shows (a
 * formula's worked-out value, not `=B2*C2`). The empty rows at the bottom of
 * the grid and empty, unnamed columns on the right are left out.
 */
export function sheetToCsv(
  columns: SheetColumn[],
  rows: SheetRow[],
  displayAt: (col: number, row: number) => string,
) {
  const grid = rows.map((_, rowIndex) => columns.map((_, colIndex) => displayAt(colIndex, rowIndex)));
  const blank = (value: string) => value.trim() === "";

  let rowCount = grid.length;
  while (rowCount > 0 && grid[rowCount - 1].every(blank)) rowCount -= 1;

  // A column keeps its place while it has a value or a name of its own (not
  // the default letter).
  let colCount = columns.length;
  while (
    colCount > 1 &&
    (blank(columns[colCount - 1].name) || columns[colCount - 1].name === columnIndexToLetter(colCount - 1)) &&
    grid.slice(0, rowCount).every((cells) => blank(cells[colCount - 1]))
  )
    colCount -= 1;

  const header = columns
    .slice(0, colCount)
    .map((column) => csvEscape(column.name))
    .join(",");
  const body = grid.slice(0, rowCount).map((cells) => cells.slice(0, colCount).map(csvEscape).join(","));
  return [header, ...body].join("\n");
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function csvToGrid(
  text: string,
  { newColumnId, newRowId }: SheetIdFactory,
): { columns: SheetColumn[]; rows: SheetRow[] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    const columns: SheetColumn[] = [
      { id: newColumnId(), name: "A", width: 160, type: "text" },
    ];
    return {
      columns,
      rows: [{ id: newRowId(), cells: { [columns[0].id]: "" } }],
    };
  }

  const parsed = lines.map(parseCsvLine);
  const width = Math.max(...parsed.map((row) => row.length), 1);
  const header = parsed[0] ?? [];
  const columns: SheetColumn[] = Array.from({ length: width }, (_, index) => ({
    id: newColumnId(),
    name: header[index]?.trim() || columnIndexToLetter(index),
    width: 160,
    type: "text" as const,
  }));

  const body = parsed.slice(1);
  const rows: SheetRow[] = (body.length > 0 ? body : [[]]).map((cells) => {
    const mapped: Record<string, string> = {};
    columns.forEach((column, index) => {
      mapped[column.id] = cells[index] ?? "";
    });
    return { id: newRowId(), cells: mapped };
  });

  return { columns, rows };
}

/**
 * Why a CSV can't become a sheet, in the person's words, or null when it can:
 * a sheet holds at most 100 columns and 5,000 rows, as the server allows.
 * Checked before anything is sent.
 */
export function csvImportProblem(grid: { columns: SheetColumn[]; rows: SheetRow[] }): string | null {
  const count = (n: number) => n.toLocaleString("en-US");
  if (grid.columns.length > MAX_GRID_COLUMNS) {
    return `This file has ${count(grid.columns.length)} columns, and a sheet holds up to ${count(MAX_GRID_COLUMNS)}. Remove some columns, then import it again.`;
  }
  if (grid.rows.length > MAX_GRID_ROWS) {
    return `This file has ${count(grid.rows.length)} rows, and a sheet holds up to ${count(MAX_GRID_ROWS)}. Split it into smaller files, then import each one.`;
  }
  return null;
}

/** Columns the server reads types for in one request, and the longest value it is sent. */
export const COLUMN_TYPE_BATCH = 60;
const SAMPLE_VALUE_CHARS = 60;

/** A long value cut short. The "…" keeps it from reading as a number or date,
 * and it is still too long to be a select option, as the whole value is. */
function sampleValue(value: string): string {
  return value.length > SAMPLE_VALUE_CHARS ? `${value.slice(0, SAMPLE_VALUE_CHARS)}…` : value;
}

/** An imported column as smart suggestions read it: its header and up to
 * `limit` values, long ones cut short. */
export function columnSamples(
  grid: { columns: SheetColumn[]; rows: SheetRow[] },
  limit = 200,
): { name: string; values: string[] }[] {
  return grid.columns.map((column) => ({
    name: column.name.slice(0, SAMPLE_VALUE_CHARS),
    values: grid.rows.slice(0, limit).map((row) => sampleValue(row.cells[column.id] ?? "")),
  }));
}

/** columnSamples in requests of at most COLUMN_TYPE_BATCH columns each, in column order. */
export function columnSampleBatches(grid: { columns: SheetColumn[]; rows: SheetRow[] }): { name: string; values: string[] }[][] {
  const samples = columnSamples(grid);
  const batches: { name: string; values: string[] }[][] = [];
  for (let start = 0; start < samples.length; start += COLUMN_TYPE_BATCH) batches.push(samples.slice(start, start + COLUMN_TYPE_BATCH));
  return batches;
}

/** A suggested type for one imported column; null keeps it as text. */
export type ColumnTypeSuggestion = { type: string; options?: string[] } | null;

const importTypes = new Set(["number", "currency", "percent", "date", "boolean", "select"]);

/** A number written the one way that reads the same everywhere: an optional
 * sign, comma thousands groups and a decimal point. A
 * decimal comma (12,50) or a leading zero (02134, a code) does not count. */
const plainNumber = /^[-+]?(0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)(\.\d+)?$/;
const yesNo = new Set(["TRUE", "FALSE", "YES", "NO", "Y", "N"]);

/** Whether an imported value keeps its meaning in a column of this type; the
 * same rules the server uses to offer the type, applied to every row. */
function fitsImportType(type: string, value: string, options?: string[]): boolean {
  const v = value.trim();
  switch (type) {
    case "number":
    case "currency":
      return plainNumber.test(v);
    case "percent":
      return v.endsWith("%") && plainNumber.test(v.slice(0, -1).trim());
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v);
    case "boolean":
      return yesNo.has(v.toUpperCase());
    case "select":
      return !!options?.includes(v);
    default:
      return false;
  }
}

/**
 * Applies suggested column types to an imported grid. The server checks only
 * the first rows, so every row is checked again here: a column keeps a type
 * only when each value fits it, so normalizing keeps each value's meaning
 * (12.50 → 12.5, yes → TRUE). Any value that does not fit leaves the column
 * as text.
 */
export function applyColumnTypes<C extends SheetColumn, R extends SheetRow>(
  grid: { columns: C[]; rows: R[] },
  suggestions: ColumnTypeSuggestion[],
): { columns: C[]; rows: R[] } {
  const columns = grid.columns.map((column, index) => {
    const suggestion = suggestions[index];
    if (!suggestion || !importTypes.has(suggestion.type)) return column;
    const type = suggestion.type as SheetColumn["type"];
    const fits = grid.rows.every((row) => {
      const value = row.cells[column.id] ?? "";
      if (!value.trim()) return true;
      return fitsImportType(type, value, suggestion.options) && normalizeTypedCell(type, value) !== "";
    });
    if (!fits) return column;
    return {
      ...column,
      type,
      ...(type === "select" && suggestion.options?.length ? { options: suggestion.options } : {}),
    };
  });
  const rows = grid.rows.map((row) => {
    const cells = { ...row.cells };
    columns.forEach((column, index) => {
      if (column.type === grid.columns[index].type) return;
      const value = cells[column.id];
      if (value !== undefined) cells[column.id] = normalizeTypedCell(column.type, value);
    });
    return { ...row, cells };
  });
  return { columns, rows };
}

/**
 * Types an imported grid's columns from smart suggestions, asked in batches
 * the server accepts (columnSampleBatches). A batch that fails, or answers
 * with suggestions off, leaves its columns as text; applyColumnTypes checks
 * every row before a type is kept.
 */
export async function typeImportedColumns<C extends SheetColumn, R extends SheetRow>(
  grid: { columns: C[]; rows: R[] },
  ask: (columns: { name: string; values: string[] }[]) => Promise<{ available: boolean; columns?: ColumnTypeSuggestion[] }>,
): Promise<{ columns: C[]; rows: R[] }> {
  const batches = columnSampleBatches(grid);
  const answers = await Promise.allSettled(batches.map((batch) => ask(batch)));
  let typed = false;
  const suggestions = answers.flatMap((answer, index): ColumnTypeSuggestion[] => {
    if (answer.status !== "fulfilled" || !answer.value.available) return batches[index].map(() => null);
    typed = true;
    return batches[index].map((_, column) => answer.value.columns?.[column] ?? null);
  });
  return typed ? applyColumnTypes(grid, suggestions) : grid;
}

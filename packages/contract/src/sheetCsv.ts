// Package self-import: Node strip-types cannot resolve an extensionless relative value import.
import { columnIndexToLetter } from "@timely/contract/sheetFormula";
import { normalizeTypedCell } from "@timely/contract/sheetCell";
import type { SheetColumn, SheetRow } from "./sheetTypes";

/** Id generators differ per platform, so callers supply them. */
export interface SheetIdFactory {
  newColumnId: () => string;
  newRowId: () => string;
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function sheetToCsv(
  columns: SheetColumn[],
  rows: SheetRow[],
  displayAt: (col: number, row: number) => string,
) {
  const header = columns.map((column) => csvEscape(column.name)).join(",");
  const body = rows.map((row, rowIndex) =>
    columns
      .map((column, colIndex) => {
        const raw = row.cells?.[column.id] ?? "";
        const shown = displayAt(colIndex, rowIndex);
        return csvEscape(raw.startsWith("=") ? raw : shown);
      })
      .join(","),
  );
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

/** An imported column as smart suggestions read it: its header and up to
 * `limit` values. */
export function columnSamples(
  grid: { columns: SheetColumn[]; rows: SheetRow[] },
  limit = 200,
): { name: string; values: string[] }[] {
  return grid.columns.map((column) => ({
    name: column.name,
    values: grid.rows.slice(0, limit).map((row) => row.cells[column.id] ?? ""),
  }));
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

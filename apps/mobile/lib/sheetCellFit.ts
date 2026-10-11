import { isFormulaValue } from "@timely/contract/sheetCell";
import type { CellFitInput } from "./api/decisions";
import type { SheetColumn, SheetRow } from "./types";

/** One edited cell to check, with an id that is new for every edit. */
export type CellFitCheck = { id: number; rowId: string; columnId: string; input: CellFitInput };

let cellFitSeq = 0;

/** The edited cell to check against its column, or null when a typed column,
 * a formula or an unchanged entry leaves nothing to ask. `rows` is the grid
 * the value goes into, already grown when the cell was past the end, so a
 * brand-new row is checked like any other. */
export function cellFitEdit(column: SheetColumn, rows: SheetRow[], rowIndex: number, value: string): CellFitCheck | null {
  const row = rows[rowIndex];
  if (!row || (column.type !== "text" && column.type !== "select")) return null;
  const entry = value.trim();
  if (!entry || isFormulaValue(entry) || entry === String(row.cells?.[column.id] ?? "").trim()) return null;
  const values = new Set<string>();
  for (const other of rows) {
    if (other.id === row.id) continue;
    const v = String(other.cells?.[column.id] ?? "").trim();
    if (v && !isFormulaValue(v)) values.add(v);
    if (values.size >= 50) break;
  }
  cellFitSeq += 1;
  return {
    id: cellFitSeq,
    rowId: row.id,
    columnId: column.id,
    input: { column: column.name, type: column.type, value: entry, values: [...values], options: column.options },
  };
}

import type { SheetColumn, SheetRow } from "./types";

export type Grid = { columns: SheetColumn[]; rows: SheetRow[] };
type Address = { col: number; row: number };

export function isPastGrid(grid: Grid, address: Address) {
  return address.col >= grid.columns.length || address.row >= grid.rows.length;
}

// Adds blank columns and rows until `address` exists. The grid only grows when
// something is written there: selecting a blank cell past the end must not
// save rows, or an open assistant proposal goes stale for no visible change.
// Returns the same arrays when nothing had to be added.
export function growGridTo(
  grid: Grid,
  address: Address,
  makeColumn: (index: number) => SheetColumn,
  makeRow: (columns: SheetColumn[]) => SheetRow,
): Grid {
  let { columns, rows } = grid;
  if (address.col >= columns.length) {
    const extra: SheetColumn[] = [];
    for (let i = columns.length; i <= address.col; i += 1) extra.push(makeColumn(i));
    columns = [...columns, ...extra];
    rows = rows.map((row) => {
      const cells = { ...row.cells };
      for (const column of extra) cells[column.id] = "";
      return { ...row, cells };
    });
  }
  if (address.row >= rows.length) {
    const extra: SheetRow[] = [];
    for (let i = rows.length; i <= address.row; i += 1) extra.push(makeRow(columns));
    rows = [...rows, ...extra];
  }
  return { columns, rows };
}

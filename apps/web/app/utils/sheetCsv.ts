import { getColumnTypeSuggestions } from "@/app/utils/api/decisions";
import type { SheetColumn, SheetRow } from "@/app/_types/types";
import {
  csvImportProblem,
  csvToGrid as parseCsvToGrid,
  sheetToCsv,
  typeImportedColumns,
} from "@timely/contract/sheetCsv";
import { newColumnId, newRowId } from "@/app/utils/sheetColumns";

export { sheetToCsv };

export function csvToGrid(text: string): { columns: SheetColumn[]; rows: SheetRow[] } {
  return parseCsvToGrid(text, { newColumnId, newRowId });
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads a CSV for import and, when smart suggestions are on, types the
 * columns whose values all fit a type (Amount as currency, Status as a
 * select). Without suggestions every column stays text, as before. Throws,
 * with the reason, for a file larger than a sheet holds.
 */
export async function importCsvGrid(text: string): Promise<{ columns: SheetColumn[]; rows: SheetRow[] }> {
  const grid = csvToGrid(text);
  const problem = csvImportProblem(grid);
  if (problem) throw new Error(problem);
  return typeImportedColumns(grid, getColumnTypeSuggestions);
}

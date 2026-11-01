import { getColumnTypeSuggestions } from "./api/decisions";
import {
  csvImportProblem,
  csvToGrid as parseCsvToGrid,
  sheetToCsv,
  typeImportedColumns,
} from "@timely/contract/sheetCsv";
import { newSheetId } from "./sheet";
import type { SheetColumn, SheetRow } from "./types";

export { sheetToCsv };

export function csvToGrid(text: string): { columns: SheetColumn[]; rows: SheetRow[] } {
  return parseCsvToGrid(text, {
    newColumnId: () => newSheetId("col"),
    newRowId: () => newSheetId("row"),
  });
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

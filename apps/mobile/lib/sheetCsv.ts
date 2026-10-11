import { getColumnTypeSuggestions } from "./api/decisions";
import {
  applyColumnTypes,
  columnSamples,
  csvToGrid as parseCsvToGrid,
  sheetToCsv,
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
 * select). Without suggestions every column stays text, as before.
 */
export async function importCsvGrid(text: string): Promise<{ columns: SheetColumn[]; rows: SheetRow[] }> {
  const grid = csvToGrid(text);
  try {
    const suggested = await getColumnTypeSuggestions(columnSamples(grid));
    return suggested.available ? applyColumnTypes(grid, suggested.columns) : grid;
  } catch {
    return grid;
  }
}

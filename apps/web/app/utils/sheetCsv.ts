import { getColumnTypeSuggestions } from "@/app/utils/api/decisions";
import type { SheetColumn, SheetRow } from "@/app/_types/types";
import {
  applyColumnTypes,
  columnSamples,
  csvToGrid as parseCsvToGrid,
  sheetToCsv,
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

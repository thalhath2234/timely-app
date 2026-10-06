import { csvToGrid as parseCsvToGrid, sheetToCsv } from "@timely/contract/sheetCsv";
import { newSheetId } from "./sheet";
import type { SheetColumn, SheetRow } from "./types";

export { sheetToCsv };

export function csvToGrid(text: string): { columns: SheetColumn[]; rows: SheetRow[] } {
  return parseCsvToGrid(text, {
    newColumnId: () => newSheetId("col"),
    newRowId: () => newSheetId("row"),
  });
}

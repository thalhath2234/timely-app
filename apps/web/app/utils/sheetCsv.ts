import type { SheetColumn, SheetRow } from "@/app/_types/types";
import { csvToGrid as parseCsvToGrid, sheetToCsv } from "@timely/contract/sheetCsv";
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

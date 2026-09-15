import type { SheetColumn, SheetRow } from "@/app/_types/types";
import { columnIndexToLetter } from "@/app/utils/sheetFormula";
import { newColumnId, newRowId } from "@/app/utils/sheetColumns";

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

function parseCsvLine(line: string): string[] {
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

export function csvToGrid(text: string): { columns: SheetColumn[]; rows: SheetRow[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    const columns: SheetColumn[] = [
      { id: newColumnId(), name: "A", width: 160, type: "text" },
    ];
    return { columns, rows: [{ id: newRowId(), cells: { [columns[0].id]: "" } }] };
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

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

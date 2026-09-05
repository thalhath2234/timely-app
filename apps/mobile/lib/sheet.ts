import type { Sheet, SheetColumn, SheetColumnType, SheetRow } from "./types";
import { columnIndexToLetter } from "./sheetFormula";

export const SHEET_ICON_CHOICES = [
  "📊", "📈", "📉", "🧮", "💰", "📋", "🗓️", "⚙️",
  "🎯", "🔢", "📦", "🏷️", "⏱️", "✅", "⭐", "🧾",
] as const;

export const SHEET_COLUMN_TYPES: { value: SheetColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
];

export function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function sheetHref(id: string) {
  return { pathname: "/(app)/sheets/[id]", params: { id } } as const;
}

export function newSheetId(prefix: string) {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function normalizeColumns(columns: SheetColumn[] | null | undefined): SheetColumn[] {
  if (!Array.isArray(columns)) return [];
  return columns.map((column, index) => ({
    id: column?.id || newSheetId("col"),
    name: column?.name?.trim() || columnIndexToLetter(index),
    width: typeof column?.width === "number" && column.width > 0 ? column.width : 140,
    type: SHEET_COLUMN_TYPES.some((t) => t.value === column?.type) ? column.type : "text",
  }));
}

export function normalizeRows(rows: SheetRow[] | null | undefined): SheetRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const cells: Record<string, string> = {};
    const raw = row?.cells && typeof row.cells === "object" ? row.cells : {};
    for (const [key, value] of Object.entries(raw)) {
      cells[key] = cellText(value);
    }
    return { id: row?.id || newSheetId("row") || `row_${index}`, cells };
  });
}

export function normalizeSheet(sheet: Sheet): Sheet {
  return {
    ...sheet,
    title: sheet.title ?? "",
    description: sheet.description ?? "",
    columns: normalizeColumns(sheet.columns),
    rows: normalizeRows(sheet.rows),
  };
}

export function emptySheetRow(columns: SheetColumn[]): SheetRow {
  const cells: Record<string, string> = {};
  for (const column of columns) cells[column.id] = "";
  return { id: newSheetId("row"), cells };
}

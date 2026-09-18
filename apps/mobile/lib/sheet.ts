import type { Sheet, SheetCellFormat, SheetColumn, SheetColumnType, SheetMerge, SheetRow, SheetTab } from "./types";
import { columnIndexToLetter } from "./sheetFormula";

export const SHEET_ICON_CHOICES = [
  "📊", "📈", "📉", "🧮", "💰", "📋", "🗓️", "⚙️",
  "🎯", "🔢", "📦", "🏷️", "⏱️", "✅", "⭐", "🧾",
] as const;

export const SHEET_COLUMN_TYPES: { value: SheetColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "formula", label: "Formula" },
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
    return {
      id: row?.id || newSheetId("row") || `row_${index}`,
      cells,
      formats: row?.formats,
    };
  });
}

export function normalizeTab(tab: SheetTab, index = 0, fallbackName = "Sheet 1"): SheetTab {
  return {
    id: tab?.id || newSheetId("tab"),
    name: tab?.name?.trim() || (index === 0 ? fallbackName : `Sheet ${index + 1}`),
    columns: normalizeColumns(tab?.columns),
    rows: normalizeRows(tab?.rows),
    merges: tab?.merges ?? [],
  };
}

export function normalizeSheet(sheet: Sheet): Sheet {
  const columns = normalizeColumns(sheet.columns);
  const rows = normalizeRows(sheet.rows);
  const merges = sheet.merges ?? [];
  return {
    ...sheet,
    title: sheet.title ?? "",
    description: sheet.description ?? "",
    columns,
    rows,
    merges,
    tabs: (sheet.tabs ?? []).map((tab, index) =>
      normalizeTab(tab, index, sheet.title || "Sheet 1"),
    ),
  };
}

export function emptySheetRow(columns: SheetColumn[]): SheetRow {
  const cells: Record<string, string> = {};
  for (const column of columns) cells[column.id] = "";
  return { id: newSheetId("row"), cells };
}

export function defaultTabGrid(): { columns: SheetColumn[]; rows: SheetRow[] } {
  const columns: SheetColumn[] = ["A", "B", "C", "D"].map((name) => ({
    id: newSheetId("col"),
    name,
    width: 160,
    type: "text",
  }));
  const rows = Array.from({ length: 20 }, () => emptySheetRow(columns));
  return { columns, rows };
}

export function tabsFromSheet(sheet: Sheet): SheetTab[] {
  if (sheet.tabs && sheet.tabs.length > 0) {
    return sheet.tabs.map((tab, index) => normalizeTab(tab, index, sheet.title || "Sheet 1"));
  }
  return [
    {
      id: newSheetId("tab"),
      name: sheet.title || "Sheet 1",
      columns: normalizeColumns(sheet.columns),
      rows: normalizeRows(sheet.rows),
      merges: sheet.merges ?? [],
    },
  ];
}

export function workbookPayload(tabs: SheetTab[]) {
  const primary = tabs[0];
  return {
    columns: primary?.columns ?? [],
    rows: primary?.rows ?? [],
    merges: primary?.merges ?? [],
    tabs: tabs.length > 1 ? tabs : [],
  };
}

export function addWorkbookTab(tabs: SheetTab[]): SheetTab[] {
  const grid = defaultTabGrid();
  return [
    ...tabs,
    {
      id: newSheetId("tab"),
      name: `Sheet ${tabs.length + 1}`,
      columns: grid.columns.map((column, index) => ({
        ...column,
        name: column.name || columnIndexToLetter(index),
      })),
      rows: grid.rows,
      merges: [] as SheetMerge[],
    },
  ];
}

export function isFormulaValue(value: string) {
  return value.trim().startsWith("=");
}

export function normalizeTypedCell(type: SheetColumnType | undefined, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed) || !type || type === "text") return value;
  if (type === "number" || type === "currency" || type === "percent" || type === "formula") {
    const hadPercent = trimmed.endsWith("%");
    const parsed = Number(trimmed.replace(/%/g, "").replace(/,/g, "").trim());
    if (!Number.isFinite(parsed)) return "";
    return String(hadPercent ? parsed / 100 : parsed);
  }
  if (type === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (type === "boolean") {
    const upper = trimmed.toUpperCase();
    if (["TRUE", "1", "YES", "Y"].includes(upper)) return "TRUE";
    if (["FALSE", "0", "NO", "N"].includes(upper)) return "FALSE";
    return "";
  }
  return value;
}

export function formatCellDisplay(
  display: string,
  format: SheetCellFormat | undefined,
  columnType?: SheetColumnType,
): string {
  if (!format && columnType !== "currency" && columnType !== "percent") return display;
  const parsed = Number(String(display).replace(/,/g, "").replace(/%/g, "").trim());
  if (!Number.isFinite(parsed)) return display;
  const kind = format?.numberFormat ?? (columnType === "currency" ? "currency" : columnType === "percent" ? "percent" : undefined);
  const digits = format?.decimals;
  if (kind === "currency") {
    return parsed.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
  }
  if (kind === "percent") {
    return parsed.toLocaleString(undefined, { style: "percent", minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 0 });
  }
  if (kind === "number" || digits != null) {
    return parsed.toLocaleString(undefined, { minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 2 });
  }
  return display;
}

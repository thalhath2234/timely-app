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
  { value: "select", label: "Dropdown" },
];

export const MAX_SELECT_OPTIONS = 200;

export function columnTypeBadge(type: SheetColumnType | undefined) {
  if (type === "select") return "▾";
  return type?.[0]?.toUpperCase() ?? "T";
}

/** Trims, drops blanks and case-insensitive duplicates (first spelling wins). */
export function normalizeSelectOptions(options: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of options ?? []) {
    const trimmed = String(option ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_SELECT_OPTIONS) break;
  }
  return out;
}

/** The stored spelling of `value` among `options`, or undefined when it is new. */
export function matchSelectOption(options: readonly string[] | undefined, value: string) {
  const key = value.trim().toLowerCase();
  return (options ?? []).find((option) => option.toLowerCase() === key);
}

/** Parses the one-per-line text of the options editor. */
export function parseSelectOptions(text: string): string[] {
  return normalizeSelectOptions(text.split(/\r?\n|,/));
}

/**
 * Keeps select columns truthful after any cell change: cell values take the
 * spelling of the matching option, and values that are not an option yet are
 * appended to the column. Returns the same arrays when nothing changed.
 */
export function syncSelectOptions(
  columns: SheetColumn[],
  rows: SheetRow[],
): { columns: SheetColumn[]; rows: SheetRow[] } {
  const selectColumns = columns.filter((column) => column.type === "select");
  if (selectColumns.length === 0) return { columns, rows };

  const nextOptions = new Map<string, string[]>();
  for (const column of selectColumns) {
    nextOptions.set(column.id, normalizeSelectOptions(column.options));
  }

  let rowsChanged = false;
  const nextRows = rows.map((row) => {
    let cells: Record<string, string> | null = null;
    for (const column of selectColumns) {
      const raw = row.cells?.[column.id] ?? "";
      const trimmed = raw.trim();
      if (!trimmed || isFormulaValue(trimmed)) continue;
      const options = nextOptions.get(column.id)!;
      const match = matchSelectOption(options, trimmed);
      let canonical = trimmed;
      if (match) canonical = match;
      else if (options.length < MAX_SELECT_OPTIONS) options.push(trimmed);
      if (canonical !== raw) {
        cells = cells ?? { ...row.cells };
        cells[column.id] = canonical;
      }
    }
    if (!cells) return row;
    rowsChanged = true;
    return { ...row, cells };
  });

  let columnsChanged = false;
  const nextColumns = columns.map((column) => {
    if (column.type !== "select") return column;
    const options = nextOptions.get(column.id)!;
    const before = column.options ?? [];
    if (before.length === options.length && before.every((option, index) => option === options[index])) {
      return column;
    }
    columnsChanged = true;
    return { ...column, options };
  });

  return {
    columns: columnsChanged ? nextColumns : columns,
    rows: rowsChanged ? nextRows : rows,
  };
}

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
  return columns.map((column, index) => {
    const type: SheetColumnType = SHEET_COLUMN_TYPES.some((t) => t.value === column?.type)
      ? column.type
      : "text";
    const next: SheetColumn = {
      id: column?.id || newSheetId("col"),
      name: column?.name?.trim() || columnIndexToLetter(index),
      width: typeof column?.width === "number" && column.width > 0 ? column.width : 140,
      type,
    };
    if (type === "select") next.options = normalizeSelectOptions(column?.options);
    return next;
  });
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

/** Works for sheets and templates (pass `{ ...template, title: template.name }`). */
export function tabsFromSheet(sheet: Pick<Sheet, "title" | "columns" | "rows" | "merges" | "tabs">): SheetTab[] {
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

/**
 * The primary grid is mirrored onto columns/rows/merges for older readers,
 * and every tab (including the first) is sent so its own name survives.
 */
export function workbookPayload(tabs: SheetTab[]) {
  const primary = tabs[0];
  return {
    columns: primary?.columns ?? [],
    rows: primary?.rows ?? [],
    merges: primary?.merges ?? [],
    tabs,
  };
}

export function addWorkbookTab(tabs: SheetTab[], from?: SheetTab): SheetTab[] {
  if (from) {
    return [
      ...tabs,
      {
        ...from,
        id: from.id || newSheetId("tab"),
        name: from.name?.trim() || `Sheet ${tabs.length + 1}`,
        merges: from.merges ?? [],
      },
    ];
  }
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
  if (type === "select") return trimmed;
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

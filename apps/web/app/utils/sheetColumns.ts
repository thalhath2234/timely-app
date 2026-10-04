import type {
  SheetCellFormat,
  SheetColumn,
  SheetColumnType,
  SheetNumberFormat,
  SheetRow,
} from "@/app/_types/types";

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

export const newColumnId = () => `col_${crypto.randomUUID()}`;
export const newRowId = () => `row_${crypto.randomUUID()}`;
export const newTabId = () => `tab_${crypto.randomUUID()}`;

export function isFormulaValue(value: string) {
  return value.trim().startsWith("=");
}

export function normalizeTypedCell(
  type: SheetColumnType | undefined,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed) || !type || type === "text") return value;

  if (
    type === "number" ||
    type === "currency" ||
    type === "percent" ||
    type === "formula"
  ) {
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

/** Trims, drops blanks and case-insensitive duplicates (first spelling wins). */
export function normalizeSelectOptions(options: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of options ?? []) {
    const trimmed = option.trim();
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
    if (
      before.length === options.length &&
      before.every((option, index) => option === options[index])
    ) {
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

export function isBooleanTrue(value: string) {
  const upper = value.trim().toUpperCase();
  return upper === "TRUE" || upper === "1" || upper === "YES";
}

export function emptyFormats(
  formats: Record<string, SheetCellFormat> | undefined,
): Record<string, SheetCellFormat> {
  return { ...(formats ?? {}) };
}

export function isEmptyCellFormat(format: SheetCellFormat): boolean {
  return (
    !format.bold &&
    !format.italic &&
    !format.underline &&
    !format.strikethrough &&
    !format.align &&
    !format.verticalAlign &&
    !format.wrap &&
    !format.clip &&
    !format.rotation &&
    !format.numberFormat &&
    format.decimals == null &&
    !format.textColor &&
    !format.fillColor &&
    !format.border &&
    !format.link &&
    !format.fontSize &&
    !format.fontFamily &&
    !format.note
  );
}

export function setCellFormat(
  formats: Record<string, SheetCellFormat> | undefined,
  columnId: string,
  patch: Partial<SheetCellFormat>,
): Record<string, SheetCellFormat> | undefined {
  const next = emptyFormats(formats);
  const merged: SheetCellFormat = { ...(next[columnId] ?? {}), ...patch };
  if (!merged.bold) delete merged.bold;
  if (!merged.italic) delete merged.italic;
  if (!merged.underline) delete merged.underline;
  if (!merged.strikethrough) delete merged.strikethrough;
  if (!merged.align) delete merged.align;
  if (!merged.verticalAlign) delete merged.verticalAlign;
  if (!merged.wrap) delete merged.wrap;
  if (!merged.clip) delete merged.clip;
  if (!merged.rotation) delete merged.rotation;
  if (!merged.numberFormat) delete merged.numberFormat;
  if (merged.decimals == null) delete merged.decimals;
  if (!merged.textColor) delete merged.textColor;
  if (!merged.fillColor) delete merged.fillColor;
  if (!merged.border) delete merged.border;
  if (!merged.link) delete merged.link;
  if (!merged.fontSize) delete merged.fontSize;
  if (!merged.fontFamily) delete merged.fontFamily;
  if (!merged.note) delete merged.note;
  if (isEmptyCellFormat(merged)) {
    delete next[columnId];
  } else {
    next[columnId] = merged;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function toggleNumberFormat(
  current: SheetNumberFormat | undefined,
  next: SheetNumberFormat,
): SheetNumberFormat | undefined {
  return current === next ? undefined : next;
}

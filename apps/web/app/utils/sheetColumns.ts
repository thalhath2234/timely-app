import type {
  SheetCellFormat,
  SheetColumnType,
  SheetNumberFormat,
} from "@/app/_types/types";

export const SHEET_COLUMN_TYPES: { value: SheetColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "formula", label: "Formula" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
];

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

  return value;
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

export function setCellFormat(
  formats: Record<string, SheetCellFormat> | undefined,
  columnId: string,
  patch: Partial<SheetCellFormat>,
): Record<string, SheetCellFormat> | undefined {
  const next = emptyFormats(formats);
  const merged = { ...(next[columnId] ?? {}), ...patch };
  if (!merged.bold) delete merged.bold;
  if (!merged.align) delete merged.align;
  if (!merged.numberFormat) delete merged.numberFormat;
  if (!merged.bold && !merged.align && !merged.numberFormat) {
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

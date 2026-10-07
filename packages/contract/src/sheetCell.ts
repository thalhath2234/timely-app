import type { SheetColumnType } from "./sheetTypes";

export function isFormulaValue(value: string) {
  return value.trim().startsWith("=");
}

/**
 * Coerces a typed value to the column type. Formulas and blanks are left
 * alone; invalid number/date/boolean input becomes "". Mirrors the API's
 * NormalizeTypedCell (apps/api/internal/models/sheet.go) for the common
 * inputs; the date parsing of free-form text uses the JS Date parser.
 */
export function normalizeTypedCell(
  type: SheetColumnType | undefined,
  value: string,
): string {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed) || !type || type === "text")
    return value;

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

import type { SheetColumnType } from "@/app/_types/types";

export const SHEET_COLUMN_TYPES: { value: SheetColumnType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
];

export function isFormulaValue(value: string) {
  return value.trim().startsWith("=");
}

export function normalizeTypedCell(type: SheetColumnType | undefined, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isFormulaValue(trimmed) || !type || type === "text") return value;

  if (type === "number") {
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? String(parsed) : "";
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

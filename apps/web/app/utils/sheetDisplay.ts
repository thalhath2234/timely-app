import type {
  SheetAlign,
  SheetCellFormat,
  SheetColumnType,
  SheetNumberFormat,
} from "@/app/_types/types";
import type { CellResult } from "@timely/contract/sheetFormula";
import { formatCellResult } from "@timely/contract/sheetFormula";
import { isFormulaValue } from "@timely/contract/sheetCell";

export const SHEET_STATUS_CHIPS: Record<
  string,
  { className: string; label: string }
> = {
  verified: {
    label: "Verified",
    className:
      "bg-success/10 text-success border-success/20",
  },
  "in review": {
    label: "In Review",
    className: "bg-warning/10 text-warning border-warning/20",
  },
  ready: {
    label: "Ready",
    className: "bg-muted text-muted-foreground border-border",
  },
  blocked: {
    label: "Blocked",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export function columnTypeBadge(type: SheetColumnType | undefined) {
  switch (type) {
    case "number":
      return "#";
    case "currency":
      return "$";
    case "percent":
      return "%";
    case "formula":
      return "fx";
    case "date":
      return "D";
    case "boolean":
      return "☐";
    case "select":
      return "▾";
    default:
      return "T";
  }
}

export function defaultAlign(type: SheetColumnType | undefined): SheetAlign {
  if (type === "number" || type === "currency" || type === "percent" || type === "formula") {
    return "right";
  }
  if (type === "boolean") return "center";
  return "left";
}

export function cycleAlign(current: SheetAlign | undefined): SheetAlign {
  if (current === "left") return "center";
  if (current === "center") return "right";
  return "left";
}

export function numericColumnType(type: SheetColumnType | undefined) {
  return (
    type === "number" ||
    type === "currency" ||
    type === "percent" ||
    type === "formula"
  );
}

function formatNumber(
  value: number,
  format: SheetNumberFormat | undefined,
  decimals?: number,
) {
  if (!Number.isFinite(value)) return "#NUM!";
  const digits =
    decimals ?? (format === "currency" ? 2 : format === "percent" ? 2 : undefined);
  const options =
    digits == null
      ? { maximumFractionDigits: 10 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (format === "currency") {
    return value.toLocaleString(undefined, options);
  }
  if (format === "percent") {
    return `${(value * 100).toLocaleString(undefined, options)}%`;
  }
  if (format === "scientific") {
    return value.toExponential(digits ?? 2);
  }
  if (format === "plain") {
    return String(value);
  }
  if (digits != null) {
    return value.toLocaleString(undefined, options);
  }
  return formatCellResult({ type: "number", value });
}

export function resolveNumberFormat(
  type: SheetColumnType | undefined,
  cellFormat?: SheetCellFormat,
): SheetNumberFormat | undefined {
  if (cellFormat?.numberFormat) return cellFormat.numberFormat;
  if (type === "currency") return "currency";
  if (type === "percent") return undefined;
  return undefined;
}

export function formatSheetDisplay(
  result: CellResult,
  type: SheetColumnType | undefined,
  raw: string,
  cellFormat?: SheetCellFormat,
): string {
  if (result.type === "error") return result.message;
  if (result.type === "empty") return "";
  if (result.type === "boolean") return result.value ? "TRUE" : "FALSE";
  if (result.type === "number") {
    return formatNumber(
      result.value,
      resolveNumberFormat(type, cellFormat),
      cellFormat?.decimals,
    );
  }
  if (type === "percent" && result.type === "text" && !isFormulaValue(raw)) {
    const parsed = Number(result.value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return formatNumber(parsed, undefined, cellFormat?.decimals);
  }
  return formatCellResult(result);
}

export function statusChip(text: string) {
  return SHEET_STATUS_CHIPS[text.trim().toLowerCase()] ?? null;
}

export function cellFormatFontFamily(family: SheetCellFormat["fontFamily"] | undefined) {
  if (family === "serif") return "Georgia, 'Times New Roman', serif";
  if (family === "mono") return "ui-monospace, SFMono-Regular, Menlo, monospace";
  return undefined;
}

export function cellTextDecoration(format: SheetCellFormat | undefined) {
  const parts = [
    format?.underline ? "underline" : "",
    format?.strikethrough ? "line-through" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

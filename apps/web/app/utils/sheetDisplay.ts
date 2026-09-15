import type {
  SheetAlign,
  SheetCellFormat,
  SheetColumnType,
  SheetNumberFormat,
} from "@/app/_types/types";
import type { CellResult } from "@/app/utils/sheetFormula";
import { formatCellResult } from "@/app/utils/sheetFormula";
import { isFormulaValue } from "@/app/utils/sheetColumns";

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

function formatNumber(value: number, format: SheetNumberFormat | undefined) {
  if (!Number.isFinite(value)) return "#NUM!";
  if (format === "currency") {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (format === "percent") {
    return `${(value * 100).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}%`;
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
    return formatNumber(result.value, resolveNumberFormat(type, cellFormat));
  }
  if (type === "percent" && result.type === "text" && !isFormulaValue(raw)) {
    const parsed = Number(result.value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return formatNumber(parsed, undefined);
  }
  return formatCellResult(result);
}

export function statusChip(text: string) {
  return SHEET_STATUS_CHIPS[text.trim().toLowerCase()] ?? null;
}

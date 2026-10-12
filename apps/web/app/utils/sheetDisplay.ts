import type { SheetAlign, SheetCellFormat, SheetColumnType } from "@/app/_types/types";

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

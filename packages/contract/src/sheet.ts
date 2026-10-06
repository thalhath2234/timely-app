import type {
  SheetColumn,
  SheetMerge,
  SheetRow as SheetRowCells,
} from "./sheetTypes";

/** Wire shape of a sheet (`models/sheet.go`). Cell logic lives in sheet*.ts. */

export type SheetAlign = "left" | "center" | "right";
export type SheetVerticalAlign = "top" | "middle" | "bottom";
export type SheetNumberFormat =
  | "number"
  | "currency"
  | "percent"
  | "scientific"
  | "plain";
export type SheetBorder = "all" | "outer" | "bottom" | "top" | "left" | "right";
export type SheetFontFamily = "default" | "serif" | "mono";

export interface SheetCellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: SheetAlign;
  verticalAlign?: SheetVerticalAlign;
  wrap?: boolean;
  clip?: boolean;
  rotation?: number;
  numberFormat?: SheetNumberFormat;
  decimals?: number;
  textColor?: string;
  fillColor?: string;
  border?: SheetBorder;
  link?: string;
  fontSize?: number;
  fontFamily?: SheetFontFamily;
  note?: string;
}

export interface SheetRow extends SheetRowCells {
  formats?: Record<string, SheetCellFormat>;
}

export interface SheetTab {
  id: string;
  name: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
}

export interface Sheet {
  id: string;
  title: string;
  icon: string | null;
  columns: SheetColumn[];
  rows: SheetRow[];
  merges: SheetMerge[];
  tabs: SheetTab[];
  workspaceId: string;
  projectId: string | null;
  userId: string;
  isFavorite: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SheetTemplate {
  id: string;
  userId: string;
  name: string;
  icon: string | null;
  columns: SheetColumn[];
  rows: SheetRow[];
  merges: SheetMerge[];
  tabs: SheetTab[];
  sourceSheetId: string | null;
  createdAt: string;
  updatedAt: string;
}

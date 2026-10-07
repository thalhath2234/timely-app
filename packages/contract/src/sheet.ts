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

/**
 * POST /sheets (`createSheetRequest`). `workspaceId` is a plain string on the
 * server: empty (omitted) means the account's default workspace. A
 * `templateId` creates the sheet from that template instead of the grid fields.
 * The server rejects `description`, so it is not part of the body.
 */
export interface CreateSheetPayload {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  workspaceId?: string;
  projectId?: string | null;
  templateId?: string;
}

/**
 * PUT /sheets/:id (`updateSheetRequest`). Fields are pointers on the server:
 * absent or `null` leaves the value alone; an empty `projectId` clears it.
 */
export interface UpdateSheetPayload {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  projectId?: string;
  isFavorite?: boolean;
  archived?: boolean;
}

/**
 * PUT /sheet-templates/:id (`updateTemplateRequest`). Any subset; omitted
 * fields are left untouched. Tabs mirror the first tab like sheets.
 */
export interface UpdateSheetTemplatePayload {
  name?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
}

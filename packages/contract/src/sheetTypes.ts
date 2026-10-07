/**
 * Minimal structural sheet shapes the shared sheet logic needs. The apps keep
 * their own richer row/format types; these are what the pure helpers read.
 */
export type SheetColumnType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "currency"
  | "percent"
  | "formula"
  | "select";

export interface SheetColumn {
  id: string;
  name: string;
  width: number;
  type: SheetColumnType;
  /** Dropdown choices of a select column; absent for other types. */
  options?: string[];
}

export interface SheetRow {
  id: string;
  cells: Record<string, string>;
}

export interface SheetMerge {
  startCol: number;
  startRow: number;
  colSpan: number;
  rowSpan: number;
}

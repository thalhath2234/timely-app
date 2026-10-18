/**
 * Dashboard cards built from one file: cells picked from a sheet, or a doc's
 * page or checklist. The card stores only where the data lives
 * (`SheetPick` / `DocPick`), never the data itself, so it always shows the
 * file as it is now: values are worked out with the sheet's own formula
 * engine on every render, and both clients redraw when the file changes.
 *
 * Interactive cards write back through the same payloads the editors send:
 * a counter or an edited table cell changes one cell of one tab, a quick-add
 * card inserts a row the way the grid does (formulas below and around it
 * keep pointing at the same cells), and a doc checklist flips one item.
 */
import type { DocContent } from "./documents";
import type { Sheet, SheetRow, SheetTab, UpdateSheetPayload } from "./sheet";
import { isFormulaValue, normalizeTypedCell, parseNumberInput } from "./sheetCell";
import { formatSheetCell } from "./sheetDisplay";
import { createWorkbookEvaluators } from "./sheetFormula";
import { adjustTabForStructure, applyStructureChange } from "./sheetOps";
import { columnIndexToLetter, columnLetterToIndex, shiftFormula } from "./sheetRefs";
import type { SheetColumn } from "./sheetTypes";
import type { CellResult } from "./sheetValues";

// ---- What a card stores ----

export type SheetView = "value" | "table" | "bar" | "line" | "pie" | "progress" | "counter" | "addRow";

export const SHEET_VIEWS: SheetView[] = ["value", "table", "bar", "line", "pie", "progress", "counter", "addRow"];

export const SHEET_VIEW_LABELS: Record<SheetView, string> = {
  value: "Value",
  table: "Table",
  bar: "Bars",
  line: "Line",
  pie: "Donut",
  progress: "Progress",
  counter: "Counter",
  addRow: "Quick add",
};

export const SHEET_VIEW_HINTS: Record<SheetView, string> = {
  value: "One cell, or the total of the cells you pick.",
  table: "The cells as a small table. Turn on editing to change values from the dashboard.",
  bar: "One bar per row: names from one column, values from the others.",
  line: "A line through one column's values, top to bottom.",
  pie: "Each row's share of the total.",
  progress: "The value against a goal: a number, or another cell.",
  counter: "A number you count up and down from the dashboard. It saves into the cell.",
  addRow: "A small form that adds a row to the cells you pick.",
};

export interface SheetPick {
  sheetId: string;
  /** The sheet's name when the card was made; names the card until it has its own. */
  fileTitle?: string;
  /** Tab id; empty reads the first tab. */
  tabId?: string;
  /** A1 range on that tab: `B7`, `A1:C6`, or `A1:C` for every row from 1 down. */
  range: string;
  /**
   * Ids of the rows and columns at the range's corners, so the card keeps
   * reading the same cells when rows or columns are added, moved or removed
   * above or before them. The A1 range is the fallback.
   */
  anchor?: { fromRow?: string; toRow?: string; fromCol?: string; toCol?: string };
  /**
   * Ids of the columns the card reads, when they are not all next to each
   * other (`A1:A8, C1:D8` picks A, C and D). Left out, the card reads every
   * column in the range. The range spans from the first picked column to the last.
   */
  cols?: string[];
  /** The first picked row holds names, not values. */
  headers?: boolean;
  /** Keep reading rows added below the range. */
  grow?: boolean;
  view: SheetView;
  /** Charts: the column (0-based within the range) that names each row; -1 for none. */
  labelCol?: number;
  /** Progress: the goal, as a number (`"2000"`) or a cell on the same tab (`"B7"`). */
  target?: string;
  /** Row and column ids of a goal cell, so it follows its cell like `anchor` does. */
  targetAnchor?: { row?: string; col?: string };
  /** Counter: how much one tap adds or takes away. */
  step?: number;
  /** Table: plain (non-formula) cells can be edited on the card. */
  editable?: boolean;
}

export type DocView = "page" | "checklist";

export const DOC_VIEW_LABELS: Record<DocView, string> = { page: "Page", checklist: "Checklist" };

export const DOC_VIEW_HINTS: Record<DocView, string> = {
  page: "The doc itself, kept up to date. Tick its checkboxes right on the card.",
  checklist: "Only the doc's checkboxes, with how many are done. Ticks save into the doc.",
};

export interface DocPick {
  docId: string;
  /** The doc's title when the card was made; names the card until it has its own. */
  fileTitle?: string;
  view: DocView;
  /** Only the part of the doc under this heading (its text), down to the next heading of the same or a higher level. */
  section?: string;
  /** Checklist: leave ticked items out. */
  hideDone?: boolean;
}

const VIEWS = new Set<string>(SHEET_VIEWS);

/** Cleans a stored pick: unknown views fall back to a value, bad ranges to A1. */
export function fitSheetPick(raw: SheetPick): SheetPick {
  const view: SheetView = VIEWS.has(raw.view) ? raw.view : "value";
  const range = parseRange(raw.range ?? "") ? raw.range.toUpperCase().replace(/\s+/g, "") : "A1";
  const pick: SheetPick = { sheetId: String(raw.sheetId ?? ""), range, view };
  if (typeof raw.fileTitle === "string") pick.fileTitle = raw.fileTitle.slice(0, 200);
  if (typeof raw.tabId === "string" && raw.tabId) pick.tabId = raw.tabId;
  if (raw.anchor && typeof raw.anchor === "object") {
    const anchor: NonNullable<SheetPick["anchor"]> = {};
    for (const key of ["fromRow", "toRow", "fromCol", "toCol"] as const) {
      if (typeof raw.anchor[key] === "string" && raw.anchor[key]) anchor[key] = raw.anchor[key];
    }
    if (Object.keys(anchor).length) pick.anchor = anchor;
  }
  if (Array.isArray(raw.cols)) {
    const cols = [...new Set(raw.cols.filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, 26);
    if (cols.length) pick.cols = cols;
  }
  if (raw.headers) pick.headers = true;
  if (raw.grow) pick.grow = true;
  if (typeof raw.labelCol === "number" && Number.isFinite(raw.labelCol)) pick.labelCol = Math.max(-1, Math.min(99, Math.round(raw.labelCol)));
  if (typeof raw.target === "string" && raw.target.trim()) {
    pick.target = raw.target.trim().slice(0, 40);
    const row = raw.targetAnchor?.row;
    const col = raw.targetAnchor?.col;
    if (typeof row === "string" && row && typeof col === "string" && col) pick.targetAnchor = { row, col };
  }
  if (typeof raw.step === "number" && Number.isFinite(raw.step) && raw.step > 0) pick.step = raw.step;
  if (raw.editable) pick.editable = true;
  return pick;
}

export function fitDocPick(raw: DocPick): DocPick {
  const pick: DocPick = { docId: String(raw.docId ?? ""), view: raw.view === "checklist" ? "checklist" : "page" };
  if (typeof raw.fileTitle === "string") pick.fileTitle = raw.fileTitle.slice(0, 200);
  if (typeof raw.section === "string" && raw.section.trim()) pick.section = raw.section.trim().slice(0, 200);
  if (raw.hideDone) pick.hideDone = true;
  return pick;
}

// ---- Ranges ----

export interface RangeBox {
  c0: number;
  r0: number;
  c1: number;
  /** Null when the range runs to the last row (`A2:C`). */
  r1: number | null;
}

/** Reads `B7`, `A1:C6` or `A2:C` (0-based, corners in any order). */
export function parseRange(text: string): RangeBox | null {
  const match = /^([A-Z]{1,3})(\d{1,5})(?::([A-Z]{1,3})(\d{1,5})?)?$/i.exec(text.trim());
  if (!match) return null;
  const c0 = columnLetterToIndex(match[1].toUpperCase());
  const r0 = Number(match[2]) - 1;
  if (r0 < 0) return null;
  if (!match[3]) return { c0, r0, c1: c0, r1: r0 };
  const c1 = columnLetterToIndex(match[3].toUpperCase());
  const r1 = match[4] ? Number(match[4]) - 1 : null;
  if (r1 !== null && r1 < 0) return null;
  return {
    c0: Math.min(c0, c1),
    c1: Math.max(c0, c1),
    r0: r1 === null ? r0 : Math.min(r0, r1),
    r1: r1 === null ? null : Math.max(r0, r1),
  };
}

export function formatRange(box: RangeBox): string {
  const start = `${columnIndexToLetter(box.c0)}${box.r0 + 1}`;
  if (box.r1 === null) return `${start}:${columnIndexToLetter(box.c1)}`;
  if (box.c0 === box.c1 && box.r0 === box.r1) return start;
  return `${start}:${columnIndexToLetter(box.c1)}${box.r1 + 1}`;
}

/** Every tab of a sheet; a sheet saved before tabs existed is one tab with an empty id. */
export function sheetTabs(sheet: Pick<Sheet, "title" | "columns" | "rows" | "merges" | "tabs">): SheetTab[] {
  if (sheet.tabs && sheet.tabs.length > 0) return sheet.tabs;
  return [{ id: "", name: sheet.title || "Sheet 1", columns: sheet.columns ?? [], rows: sheet.rows ?? [], merges: sheet.merges ?? [] }];
}

function findTab(sheet: Sheet, tabId: string | undefined): SheetTab | null {
  const tabs = sheetTabs(sheet);
  return (tabId ? tabs.find((tab) => tab.id === tabId) : undefined) ?? (tabId && sheet.tabs?.length ? null : tabs[0]) ?? null;
}

/** The ids at a range's corners, stored with the pick so it follows row and column moves. */
export function anchorFor(tab: Pick<SheetTab, "columns" | "rows">, box: RangeBox): NonNullable<SheetPick["anchor"]> {
  const anchor: NonNullable<SheetPick["anchor"]> = {};
  const fromRow = tab.rows[box.r0]?.id;
  const toRow = box.r1 === null ? undefined : tab.rows[box.r1]?.id;
  const fromCol = tab.columns[box.c0]?.id;
  const toCol = tab.columns[box.c1]?.id;
  if (fromRow) anchor.fromRow = fromRow;
  if (toRow) anchor.toRow = toRow;
  if (fromCol) anchor.fromCol = fromCol;
  if (toCol) anchor.toCol = toCol;
  return anchor;
}

function hasValue(row: SheetRow | undefined, columns: SheetColumn[], c0: number, c1: number): boolean {
  if (!row) return false;
  for (let col = c0; col <= c1; col += 1) {
    const id = columns[col]?.id;
    if (id && (row.cells?.[id] ?? "").trim() !== "") return true;
  }
  return false;
}

export interface PickBounds {
  tab: SheetTab;
  /** Inclusive, 0-based, inside the grid. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** Where a pick sits in the sheet now, or null when its tab or cells are gone. */
export function pickBounds(sheet: Sheet, pick: SheetPick): PickBounds | null {
  const tab = findTab(sheet, pick.tabId);
  const box = parseRange(pick.range);
  if (!tab || !box || tab.columns.length === 0) return null;
  const rowAt = (id: string | undefined) => (id ? tab.rows.findIndex((row) => row.id === id) : -1);
  const colAt = (id: string | undefined) => (id ? tab.columns.findIndex((column) => column.id === id) : -1);
  let r0 = rowAt(pick.anchor?.fromRow);
  if (r0 < 0) r0 = box.r0;
  let c0 = colAt(pick.anchor?.fromCol);
  if (c0 < 0) c0 = box.c0;
  let c1 = colAt(pick.anchor?.toCol);
  if (c1 < 0) c1 = box.c1;
  if (c1 < c0) [c0, c1] = [c1, c0];
  let r1: number;
  if (box.r1 === null || pick.grow) {
    // Open-ended: down to the last row that holds anything in these columns.
    const start = box.r1 === null ? r0 : Math.max(r0, rowAt(pick.anchor?.toRow) >= 0 ? rowAt(pick.anchor?.toRow) : box.r1);
    r1 = start;
    for (let row = tab.rows.length - 1; row > start; row -= 1) {
      if (hasValue(tab.rows[row], tab.columns, c0, Math.min(c1, tab.columns.length - 1))) {
        r1 = row;
        break;
      }
    }
  } else {
    r1 = rowAt(pick.anchor?.toRow);
    if (r1 < 0) r1 = box.r1;
  }
  if (r1 < r0) [r0, r1] = [r1, r0];
  if (r0 >= tab.rows.length || c0 >= tab.columns.length) return null;
  return { tab, r0, r1: Math.min(r1, tab.rows.length - 1), c0, c1: Math.min(c1, tab.columns.length - 1) };
}

/** The block of a tab that holds anything, from A1 to the last used row and column; null for an empty tab. */
export function usedBox(tab: Pick<SheetTab, "columns" | "rows">): RangeBox | null {
  let r1 = -1;
  let c1 = -1;
  tab.rows.forEach((row, r) => {
    tab.columns.forEach((column, c) => {
      if ((row.cells?.[column.id] ?? "").trim() === "") return;
      if (r > r1) r1 = r;
      if (c > c1) c1 = c;
    });
  });
  return r1 < 0 ? null : { r0: 0, c0: 0, r1, c1 };
}

/** Sets a progress card's goal: a number, or a cell on the pick's tab, which is anchored so it follows its cell. */
export function setPickTarget(sheet: Sheet, pick: SheetPick, text: string): SheetPick {
  const target = text.trim().toUpperCase();
  const next: SheetPick = { ...pick, target: target || undefined };
  delete next.targetAnchor;
  const box = parseNumberInput(target) === null ? parseRange(target) : null;
  const tab = findTab(sheet, pick.tabId);
  if (box && tab) {
    const row = tab.rows[box.r0]?.id;
    const col = tab.columns[box.c0]?.id;
    if (row && col) next.targetAnchor = { row, col };
  }
  return fitSheetPick(next);
}

/** Moves a pick to other cells of its tab, keeping the corner ids so it follows later row and column moves. */
export function repick(sheet: Sheet, pick: SheetPick, box: RangeBox): SheetPick {
  const tab = findTab(sheet, pick.tabId);
  const next: SheetPick = { ...pick, range: formatRange(box) };
  delete next.cols;
  if (tab) next.anchor = anchorFor(tab, box);
  else delete next.anchor;
  if (next.headers && box.r1 !== null && box.r0 === box.r1) delete next.headers;
  return fitSheetPick(next);
}

/** The column indexes a pick reads (in sheet order), with hidden columns left in; empty when its cells are gone. */
export function pickColumnIndexes(sheet: Sheet, pick: SheetPick): number[] {
  const bounds = pickBounds(sheet, pick);
  if (!bounds) return [];
  return columnsOf(bounds, pick);
}

function columnsOf(bounds: PickBounds, pick: SheetPick): number[] {
  if (pick.cols?.length) {
    const indexes = pick.cols.map((id) => bounds.tab.columns.findIndex((column) => column.id === id)).filter((index) => index >= 0);
    if (indexes.length) return [...new Set(indexes)].sort((a, b) => a - b);
  }
  const all: number[] = [];
  for (let col = bounds.c0; col <= bounds.c1; col += 1) all.push(col);
  return all;
}

/** Picks these columns (any order, gaps allowed) over rows r0..r1 (null: down to the last row). */
export function pickColumns(sheet: Sheet, pick: SheetPick, columns: number[], rows: { r0: number; r1: number | null }): SheetPick {
  const indexes = [...new Set(columns)].sort((a, b) => a - b);
  if (indexes.length === 0) return pick;
  const box: RangeBox = { r0: rows.r0, r1: rows.r1, c0: indexes[0], c1: indexes[indexes.length - 1] };
  const next = repick(sheet, pick, box);
  const tab = findTab(sheet, pick.tabId);
  if (tab && indexes.length < box.c1 - box.c0 + 1) {
    const ids = indexes.map((index) => tab.columns[index]?.id).filter((id): id is string => Boolean(id));
    if (ids.length === indexes.length) next.cols = ids;
  }
  return fitSheetPick(next);
}

/**
 * Adds a column to a pick, or takes it out, keeping the picked rows. A pick
 * of one row (or one cell) grows to the tab's used rows when a column is
 * added, since a whole column is what clicking its letter means.
 */
export function toggleColumn(sheet: Sheet, pick: SheetPick, column: number): SheetPick {
  const tab = findTab(sheet, pick.tabId);
  const bounds = pickBounds(sheet, pick);
  const box = parseRange(pick.range);
  if (!tab || !box) return pick;
  const current = bounds ? columnsOf(bounds, pick) : [];
  const has = current.includes(column);
  if (has && current.length === 1) return pick;
  const columns = has ? current.filter((index) => index !== column) : [...current, column];
  let rows: { r0: number; r1: number | null } = box.r1 === null ? { r0: bounds?.r0 ?? box.r0, r1: null } : { r0: bounds?.r0 ?? box.r0, r1: bounds?.r1 ?? box.r1 };
  if (!has && rows.r1 !== null && rows.r0 === rows.r1) {
    const used = usedBox(tab);
    if (used && used.r1 !== null && used.r1 > 0) rows = { r0: 0, r1: used.r1 };
  }
  return pickColumns(sheet, pick, columns, rows);
}

/**
 * Ctrl/Cmd+click or drag: adds the dragged cells' columns to a pick (rows
 * grow to cover them too). Ctrl/Cmd+clicking one cell of a picked column
 * takes that column out instead.
 */
export function addToPick(sheet: Sheet, pick: SheetPick, box: RangeBox): SheetPick {
  const bounds = pickBounds(sheet, pick);
  const stored = parseRange(pick.range);
  if (!bounds || !stored) return repick(sheet, pick, box);
  const current = columnsOf(bounds, pick);
  const open = stored.r1 === null;
  const single = box.c0 === box.c1 && box.r0 === box.r1;
  if (single && current.includes(box.c0) && box.r0 >= bounds.r0 && (open || box.r0 <= bounds.r1)) return toggleColumn(sheet, pick, box.c0);
  const columns = [...current];
  for (let col = box.c0; col <= box.c1; col += 1) columns.push(col);
  const r1 = open ? null : Math.max(bounds.r1, box.r1 ?? bounds.r1);
  return pickColumns(sheet, pick, columns, { r0: Math.min(bounds.r0, box.r0), r1 });
}

/** A pick's cells as text: `A1:C6`, or `A1:A8, C1:D8` when its columns have gaps. */
export function pickRangeText(sheet: Sheet | undefined, pick: SheetPick): string {
  if (!pick.cols?.length || !sheet) return pick.range;
  const bounds = pickBounds(sheet, pick);
  const box = parseRange(pick.range);
  if (!bounds || !box) return pick.range;
  const indexes = columnsOf(bounds, pick);
  const runs: [number, number][] = [];
  for (const index of indexes) {
    const last = runs[runs.length - 1];
    if (last && index === last[1] + 1) last[1] = index;
    else runs.push([index, index]);
  }
  const r1 = box.r1 === null ? null : bounds.r1;
  return runs.map(([c0, c1]) => formatRange({ r0: bounds.r0, r1, c0, c1 })).join(", ");
}

/**
 * Reads typed cells: one range, or several split by commas (`A1:A8, C1:D8`).
 * Several ranges pick their columns over the rows they share the most of:
 * from the highest first row to the lowest last row of any of them.
 */
export function parsePickRanges(text: string): { columns: number[]; rows: { r0: number; r1: number | null } } | null {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const boxes = parts.map(parseRange);
  if (boxes.some((box) => box === null)) return null;
  const columns = new Set<number>();
  let r0 = Infinity;
  let r1: number | null = -1;
  for (const box of boxes as RangeBox[]) {
    for (let col = box.c0; col <= box.c1; col += 1) columns.add(col);
    r0 = Math.min(r0, box.r0);
    if (box.r1 === null) r1 = null;
    else if (r1 !== null) r1 = Math.max(r1, box.r1);
  }
  return { columns: [...columns], rows: { r0, r1 } };
}

/**
 * A first pick for a sheet tab: its used cells, names in the first row when
 * the row below holds numbers, row names from the first column when it is
 * text, and bars when there are numbers to draw (a value for one cell, a
 * table otherwise).
 */
export function suggestSheetPick(sheet: Sheet, tabId?: string): SheetPick {
  const tab = findTab(sheet, tabId) ?? sheetTabs(sheet)[0];
  const id = tab?.id || undefined;
  const base: SheetPick = { sheetId: sheet.id, fileTitle: sheet.title || undefined, tabId: id, range: "A1", view: "value" };
  const box = tab ? usedBox(tab) : null;
  if (!tab || !box || box.r1 === null) return fitSheetPick(base);
  const read = readPick(sheet, { ...base, range: formatRange(box) });
  const grid = read?.grid ?? [];
  const numeric = (row: PickCell[] | undefined) => Boolean(row?.some((cell) => cell.number !== null));
  const headers = grid.length > 1 && !numeric(grid[0]) && numeric(grid[1]);
  let rows = headers ? grid.slice(1) : grid;
  // A totals row at the bottom (only formulas where the rows above hold numbers) would be the biggest bar.
  const last = rows[rows.length - 1];
  if (rows.length > 2 && last.some((cell) => cell.formula) && last.every((cell) => cell.formula || cell.number === null)) {
    rows = rows.slice(0, -1);
    box.r1 -= 1;
  }
  const textFirstCol = grid[0] && grid[0].length > 1 && rows.every((row) => row[0]?.number === null);
  const numberCols = (grid[0] ?? []).filter((_, col) => rows.some((row) => row[col]?.number !== null)).length;
  const view: SheetView = grid.length === 1 && grid[0].length === 1 ? "value" : rows.length > 1 && numberCols > 0 ? "bar" : "table";
  return repick(sheet, { ...base, headers: headers || undefined, labelCol: textFirstCol ? 0 : -1, view }, box);
}

/** The cells the workshop's picker draws: a tab's top-left block, worked out like the sheet shows them. */
export function previewGrid(sheet: Sheet, tabId: string | undefined, maxRows = 40, maxCols = 12): { columns: SheetColumn[]; grid: PickCell[][]; rows: number; cols: number } {
  const tab = findTab(sheet, tabId);
  if (!tab || tab.columns.length === 0 || tab.rows.length === 0) return { columns: [], grid: [], rows: 0, cols: 0 };
  const used = usedBox(tab);
  const rows = Math.min(tab.rows.length, Math.max(maxRows, (used?.r1 ?? 0) + 2), 200);
  const cols = Math.min(tab.columns.length, Math.max(Math.min(maxCols, tab.columns.length), (used?.c1 ?? 0) + 1), 26);
  const box: RangeBox = { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 };
  const read = readPick(sheet, { sheetId: sheet.id, tabId: tab.id || undefined, range: formatRange(box), view: "table" });
  return { columns: read?.columns ?? [], grid: read?.grid ?? [], rows, cols };
}

// ---- Reading cells ----

export interface PickCell {
  rowId: string;
  colId: string;
  /** What is stored: typed text or a formula. */
  raw: string;
  value: CellResult;
  /** What the sheet shows for it. */
  text: string;
  /** Its number, when it has one (numbers, numeric text, dates as serials are left out). */
  number: number | null;
  column: SheetColumn;
  formula: boolean;
  /** A1 address on its tab. */
  address: string;
}

function numberOf(result: CellResult, column: SheetColumn): number | null {
  if (column.type === "date") return null;
  if (result.type === "number") return result.value;
  if (result.type === "text") return parseNumberInput(result.value);
  return null;
}

// One formula engine per sheet version: it caches every cell it works out,
// so picking cells again (each tap in a card builder) doesn't redo the whole
// workbook. A changed sheet is a new object and gets a fresh engine.
const workbookEvaluators = new WeakMap<Sheet, ReturnType<typeof createWorkbookEvaluators>>();

function evaluatorsFor(sheet: Sheet) {
  let evaluators = workbookEvaluators.get(sheet);
  if (!evaluators) {
    evaluators = createWorkbookEvaluators({ tabs: sheetTabs(sheet) });
    workbookEvaluators.set(sheet, evaluators);
  }
  return evaluators;
}

/** Reads the picked cells, worked out with the sheet's own formula engine (every tab, so cross-tab formulas work). */
export function readPick(sheet: Sheet, pick: SheetPick): { bounds: PickBounds; columns: SheetColumn[]; indexes: number[]; grid: PickCell[][] } | null {
  const bounds = pickBounds(sheet, pick);
  if (!bounds) return null;
  const evaluator = evaluatorsFor(sheet)(bounds.tab.id);
  if (!evaluator) return null;
  const columnIndexes = columnsOf(bounds, pick).filter((col) => !bounds.tab.columns[col]?.hidden);
  const grid: PickCell[][] = [];
  for (let row = bounds.r0; row <= bounds.r1; row += 1) {
    const sheetRow = bounds.tab.rows[row];
    grid.push(
      columnIndexes.map((col) => {
        const column = bounds.tab.columns[col];
        const raw = sheetRow?.cells?.[column.id] ?? "";
        const value = evaluator.valueAt(col, row);
        return {
          rowId: sheetRow?.id ?? "",
          colId: column.id,
          raw,
          value,
          text: formatSheetCell(value, column, raw, sheetRow?.formats?.[column.id]),
          number: numberOf(value, column),
          column,
          formula: isFormulaValue(raw),
          address: `${columnIndexToLetter(col)}${row + 1}`,
        };
      }),
    );
  }
  return { bounds, columns: columnIndexes.map((col) => bounds.tab.columns[col]), indexes: columnIndexes, grid };
}

/** Formats a number the way a column shows it (currency, percent, decimals). */
export function formatLike(value: number, column: SheetColumn | undefined): string {
  if (!column) return formatPlain(value);
  const kind = column.type === "date" || column.type === "text" || column.type === "boolean" || column.type === "select" ? "number" : column.type;
  return formatSheetCell({ type: "number", value }, { ...column, type: kind }, String(value));
}

function formatPlain(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---- What a card draws ----

export interface SheetPoint {
  key: string;
  label: string;
  value: number;
  text: string;
}

export type SheetCardResult =
  | { kind: "missing"; message: string }
  | { kind: "value"; text: string; number: number | null; label?: string; address: string; count: number }
  | { kind: "table"; headers: string[] | null; columns: SheetColumn[]; rows: PickCell[][]; editable: boolean }
  | { kind: "chart"; view: "bar" | "line" | "pie"; series: { name: string; points: SheetPoint[] }[]; column: SheetColumn | undefined }
  | { kind: "progress"; value: number; target: number; valueText: string; targetText: string; label?: string }
  | { kind: "counter"; value: number; text: string; label?: string; cell: PickCell | null; step: number }
  | { kind: "addRow"; fields: AddRowField[]; tabName: string; afterLabel: string };

export interface AddRowField {
  colId: string;
  name: string;
  type: SheetColumn["type"];
  options?: string[];
}

const MISSING_SHEET = "This sheet was deleted or archived. Edit the card to pick another.";
const MISSING_CELLS = "The picked cells are no longer in this sheet. Edit the card to pick them again.";

/** Value cells: the picked block without its header row. */
function body(grid: PickCell[][], pick: SheetPick): PickCell[][] {
  return pick.headers && grid.length > 1 ? grid.slice(1) : grid;
}

function sumOf(cells: PickCell[]): { total: number; count: number; column: SheetColumn | undefined } {
  let total = 0;
  let count = 0;
  let column: SheetColumn | undefined;
  for (const cell of cells) {
    if (cell.number === null) continue;
    total += cell.number;
    count += 1;
    column ??= cell.column;
  }
  return { total: Math.round(total * 1e9) / 1e9, count, column };
}

/** The goal of a progress card: a number, or a cell on the same tab. */
function targetOf(sheet: Sheet, pick: SheetPick, tab: SheetTab): { value: number; text: string } | null {
  const target = pick.target?.trim();
  if (!target) return null;
  const typed = parseNumberInput(target);
  if (typed !== null) return { value: typed, text: "" };
  const box = parseRange(target);
  if (!box) return null;
  const anchor = pick.targetAnchor ? { fromRow: pick.targetAnchor.row, toRow: pick.targetAnchor.row, fromCol: pick.targetAnchor.col, toCol: pick.targetAnchor.col } : undefined;
  const read = readPick(sheet, { sheetId: pick.sheetId, tabId: tab.id || undefined, range: formatRange({ ...box, c1: box.c0, r1: box.r0 }), anchor, view: "value" });
  const cell = read?.grid[0]?.[0];
  if (!cell || cell.number === null) return null;
  return { value: cell.number, text: cell.text };
}

/** Works out what a sheet card shows. `sheet` is undefined while loading or once deleted. */
export function computeSheetCard(sheet: Sheet | undefined, rawPick: SheetPick): SheetCardResult {
  const pick = fitSheetPick(rawPick);
  if (!sheet || sheet.archivedAt) return { kind: "missing", message: MISSING_SHEET };
  const read = readPick(sheet, pick);
  if (!read) return { kind: "missing", message: MISSING_CELLS };
  const { grid, columns, indexes, bounds } = read;
  const letterOf = (index: number) => columnIndexToLetter(indexes[index] ?? bounds.c0 + index);
  const headerRow = pick.headers && grid.length > 1 ? grid[0] : null;
  const rows = body(grid, pick);
  const cells = rows.flat();
  const label = headerRow?.find((cell) => cell.text.trim())?.text;

  switch (pick.view) {
    case "value": {
      if (cells.length === 1) {
        const cell = cells[0];
        return { kind: "value", text: cell.text, number: cell.number, label, address: cell.address, count: 1 };
      }
      const sum = sumOf(cells);
      return { kind: "value", text: formatLike(sum.total, sum.column), number: sum.total, label, address: pickRangeText(sheet, pick), count: sum.count };
    }
    case "counter": {
      const cell = cells[0] ?? null;
      const value = cell?.number ?? 0;
      return { kind: "counter", value, text: cell && cell.raw.trim() ? cell.text : formatLike(value, cell?.column), label, cell, step: pick.step ?? 1 };
    }
    case "progress": {
      const sum = sumOf(cells);
      const target = targetOf(sheet, pick, bounds.tab);
      const goal = target?.value ?? 0;
      return {
        kind: "progress",
        value: sum.total,
        target: goal,
        valueText: formatLike(sum.total, sum.column),
        targetText: target?.text || formatLike(goal, sum.column),
        label,
      };
    }
    case "table": {
      // Without a names row, the sheet's own column names head the table (when it has real ones, not just letters).
      const named = columns.some((column, index) => column.name && column.name !== letterOf(index));
      const headers = headerRow ? headerRow.map((cell) => cell.text) : named ? columns.map((column) => column.name) : null;
      return { kind: "table", headers, columns, rows, editable: Boolean(pick.editable) };
    }
    case "addRow": {
      const end = addRowEnd(bounds, Boolean(pick.headers));
      const last = bounds.tab.rows[end];
      const fields: AddRowField[] = [];
      columns.forEach((column, index) => {
        // Columns whose last row is a formula copy it down instead of asking.
        if (last && isFormulaValue(last.cells?.[column.id] ?? "") && !(pick.headers && bounds.r0 === bounds.r1)) return;
        const name = headerRow?.[index]?.text.trim() || column.name || letterOf(index);
        fields.push({ colId: column.id, name, type: column.type, options: column.options });
      });
      return { kind: "addRow", fields, tabName: bounds.tab.name, afterLabel: `row ${end + 1}` };
    }
    default: {
      const view = pick.view;
      const labelCol = pick.labelCol ?? (columns.length > 1 ? 0 : -1);
      const valueCols = columns.map((_, index) => index).filter((index) => index !== labelCol);
      const used = view === "bar" ? valueCols.slice(0, 4) : valueCols.slice(0, 1);
      const series = used.map((col) => ({
        name: headerRow?.[col]?.text || columns[col]?.name || letterOf(col),
        points: rows
          .map((row, index) => {
            const cell = row[col];
            const name = labelCol >= 0 ? row[labelCol]?.text : "";
            return {
              key: cell?.rowId || String(index),
              label: name?.trim() || cell?.address || String(index + 1),
              value: cell?.number ?? 0,
              text: cell?.text ?? "",
              blank: !cell || cell.number === null,
            };
          })
          .filter((point) => !(point.blank && view !== "line"))
          .map(({ blank: _blank, ...point }) => point),
      }));
      if (view === "pie") {
        for (const entry of series) entry.points = entry.points.filter((point) => point.value > 0);
      }
      return { kind: "chart", view, series, column: columns[used[0]] };
    }
  }
}

/**
 * The row new entries go under. A totals row at the bottom of the pick
 * (formulas where the row above holds typed values) stays at the bottom:
 * entries go above it, so its sums grow to include them.
 */
function addRowEnd(bounds: PickBounds, headers: boolean): number {
  const { tab, r0, r1, c0, c1 } = bounds;
  if (r1 - 1 < r0 + (headers ? 1 : 0)) return r1;
  const last = tab.rows[r1];
  const above = tab.rows[r1 - 1];
  const ids = tab.columns.slice(c0, c1 + 1).map((column) => column.id);
  // Per-row formulas (=B5-C5 under =B4-C4) don't make a totals row; a formula under a typed value does.
  const totals = ids.some((id) => {
    const value = above?.cells?.[id] ?? "";
    return isFormulaValue(last?.cells?.[id] ?? "") && value.trim() !== "" && !isFormulaValue(value);
  });
  return totals ? r1 - 1 : r1;
}

// ---- Writing back ----

function newRowId(): string {
  const random = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `row_${random}`;
}

/** The PUT body that saves changed tabs the way the editors do. */
function tabsPayload(sheet: Sheet, next: SheetTab[]): UpdateSheetPayload {
  if (!sheet.tabs || sheet.tabs.length === 0) {
    const [first] = next;
    return { columns: first.columns, rows: first.rows, merges: first.merges };
  }
  const before = new Map(sheet.tabs.map((tab) => [tab.id, tab]));
  return { tabs: next.filter((tab) => before.get(tab.id) !== tab), tabOrder: next.map((tab) => tab.id) };
}

/**
 * Sets one cell, typed for its column. Returns the request body and the sheet
 * as it will look, so the card can show the change before the save returns;
 * null when the cell is gone or holds a formula.
 */
export function setPickCell(sheet: Sheet, tabId: string | undefined, rowId: string, colId: string, input: string): { payload: UpdateSheetPayload; sheet: Sheet } | null {
  const tabs = sheetTabs(sheet);
  const index = tabId ? tabs.findIndex((tab) => tab.id === tabId) : 0;
  const tab = tabs[index];
  if (!tab) return null;
  const column = tab.columns.find((entry) => entry.id === colId);
  const rowIndex = tab.rows.findIndex((row) => row.id === rowId);
  if (!column || rowIndex < 0) return null;
  if (isFormulaValue(tab.rows[rowIndex].cells?.[colId] ?? "")) return null;
  const value = normalizeTypedCell(column.type, input);
  const rows = tab.rows.slice();
  rows[rowIndex] = { ...rows[rowIndex], cells: { ...rows[rowIndex].cells, [colId]: value } };
  const next = tabs.map((entry, i) => (i === index ? { ...tab, rows } : entry));
  return { payload: tabsPayload(sheet, next), sheet: withTabs(sheet, next) };
}

/**
 * Adds a row right below the picked cells, as inserting a row in the grid
 * does: totals under the range grow to include it and formulas elsewhere keep
 * their cells. Columns whose row above holds a formula get it copied down.
 */
export function addPickRow(sheet: Sheet, rawPick: SheetPick, values: Record<string, string>): { payload: UpdateSheetPayload; sheet: Sheet } | null {
  const pick = fitSheetPick(rawPick);
  const bounds = pickBounds(sheet, pick);
  if (!bounds) return null;
  const tabs = sheetTabs(sheet);
  // By id: a sheet saved before tabs gets a fresh stand-in tab on every read.
  const index = tabs.findIndex((tab) => tab.id === bounds.tab.id);
  if (index < 0) return null;
  const at = addRowEnd(bounds, Boolean(pick.headers)) + 1;
  const change = { kind: "insert" as const, axis: "row" as const, at, count: 1 };
  const rowId = newRowId();
  const inserted = applyStructureChange({ ...bounds.tab, name: bounds.tab.name }, change, {
    row: (columns) => ({ id: rowId, cells: Object.fromEntries(columns.map((column) => [column.id, ""])) }),
    column: () => {
      throw new Error("rows only");
    },
  });
  const above = inserted.rows[at - 1];
  const cells: Record<string, string> = { ...inserted.rows[at].cells };
  for (const column of inserted.columns) {
    const formula = above?.cells?.[column.id] ?? "";
    if (isFormulaValue(formula) && !(column.id in values)) cells[column.id] = shiftFormula(formula, 0, 1);
  }
  for (const [colId, input] of Object.entries(values)) {
    const column = inserted.columns.find((entry) => entry.id === colId);
    if (column && input.trim() !== "") cells[colId] = normalizeTypedCell(column.type, input);
  }
  const rows = inserted.rows.slice();
  rows[at] = { ...rows[at], cells };
  const next = tabs.map((tab, i) => (i === index ? { ...tab, ...inserted, rows } : adjustTabForStructure(tab, change, bounds.tab.name)));
  return { payload: tabsPayload(sheet, next), sheet: withTabs(sheet, next) };
}

function withTabs(sheet: Sheet, tabs: SheetTab[]): Sheet {
  if (!sheet.tabs || sheet.tabs.length === 0) return { ...sheet, columns: tabs[0].columns, rows: tabs[0].rows };
  return { ...sheet, tabs, columns: tabs[0].columns, rows: tabs[0].rows };
}

// ---- Docs ----

type Node = { type?: string; attrs?: Record<string, unknown>; content?: unknown[]; text?: string };

/** Blocks whose checkboxes are not real to-dos (the same as "Make tasks" skips). */
const SKIP = new Set(["frontmatter", "codeBlock", "mermaid"]);

function asNode(value: unknown): Node | null {
  return value && typeof value === "object" ? (value as Node) : null;
}

function inlineText(node: Node): string {
  let out = "";
  for (const raw of node.content ?? []) {
    const child = asNode(raw);
    if (!child) continue;
    if (child.type === "text") out += child.text ?? "";
    else if (child.type === "mention") out += String(child.attrs?.label ?? "");
    else if (child.type === "hardBreak") out += " ";
    else if (child.type === "taskList" || child.type === "bulletList" || child.type === "orderedList") continue;
    else if (child.content) out += (out && !out.endsWith(" ") ? " " : "") + inlineText(child);
  }
  return out.replace(/\s+/g, " ").trim();
}

export type DocBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string; depth: number; marker: string }
  | { kind: "check"; text: string; depth: number; checked: boolean; index: number }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "divider" }
  | { kind: "image"; alt: string };

/**
 * A doc as a list of simple blocks for a card: headings, text, bullets and
 * checkboxes, in order. Checkboxes carry the index `toggleDocCheck` takes.
 */
export function docBlocks(content: DocContent | null | undefined, limit = 80): DocBlock[] {
  const out: DocBlock[] = [];
  let checks = 0;
  const walk = (nodes: unknown[] | undefined, depth: number) => {
    for (const raw of nodes ?? []) {
      if (out.length >= limit) return;
      const node = asNode(raw);
      if (!node) continue;
      switch (node.type) {
        case "heading":
          out.push({ kind: "heading", level: Number(node.attrs?.level) || 1, text: inlineText(node) });
          break;
        case "paragraph": {
          const text = inlineText(node);
          if (text) out.push({ kind: "paragraph", text });
          break;
        }
        case "bulletList":
        case "orderedList": {
          let number = Number(node.attrs?.start) || 1;
          for (const itemRaw of node.content ?? []) {
            const item = asNode(itemRaw);
            if (!item || out.length >= limit) continue;
            out.push({ kind: "bullet", text: inlineText(item), depth, marker: node.type === "orderedList" ? `${number}.` : "•" });
            number += 1;
            walk((item.content ?? []).filter((child) => asNode(child)?.type !== "paragraph"), depth + 1);
          }
          break;
        }
        case "taskList":
          for (const itemRaw of node.content ?? []) {
            const item = asNode(itemRaw);
            if (!item || item.type !== "taskItem") continue;
            const index = checks;
            checks += 1;
            if (out.length < limit) out.push({ kind: "check", text: inlineText(item), depth, checked: Boolean(item.attrs?.checked), index });
            walk((item.content ?? []).filter((child) => asNode(child)?.type === "taskList" || asNode(child)?.type === "bulletList"), depth + 1);
          }
          break;
        case "blockquote":
          out.push({ kind: "quote", text: inlineText(node) });
          // Keep counting checkboxes inside, so later ones keep the numbers docChecks gives them.
          checks += docChecks({ type: "doc", content: [node] } as DocContent).length;
          break;
        case "codeBlock":
        case "mermaid":
          out.push({ kind: "code", text: inlineText(node).slice(0, 400) });
          break;
        case "horizontalRule":
          out.push({ kind: "divider" });
          break;
        case "image":
          out.push({ kind: "image", alt: String(node.attrs?.alt ?? "") });
          break;
        case "frontmatter":
          break;
        default:
          if (node.content) walk(node.content, depth);
      }
    }
  };
  walk(asNode(content)?.content, 0);
  return out;
}

export interface DocCheck {
  index: number;
  text: string;
  checked: boolean;
  depth: number;
}

/** Every checkbox in a doc, in order, nested ones included. */
export function docChecks(content: DocContent | null | undefined): DocCheck[] {
  const out: DocCheck[] = [];
  const walk = (nodes: unknown[] | undefined, depth: number) => {
    for (const raw of nodes ?? []) {
      const node = asNode(raw);
      if (!node || SKIP.has(node.type ?? "")) continue;
      if (node.type === "taskItem") {
        out.push({ index: out.length, text: inlineText(node), checked: Boolean(node.attrs?.checked), depth });
        walk(node.content, depth + 1);
      } else if (node.content) {
        walk(node.content, depth);
      }
    }
  };
  walk(asNode(content)?.content, 0);
  return out;
}

/** The doc with checkbox number `index` (as `docChecks` counts) set to `checked`. */
export function toggleDocCheck(content: DocContent, index: number, checked: boolean): DocContent {
  let seen = 0;
  const visit = (raw: unknown): unknown => {
    const node = asNode(raw);
    if (!node || SKIP.has(node.type ?? "")) return raw;
    let next: Node = node;
    if (node.type === "taskItem") {
      if (seen === index) next = { ...node, attrs: { ...node.attrs, checked } };
      seen += 1;
    }
    if (node.content) {
      const content = node.content.map(visit);
      if (content.some((child, i) => child !== node.content![i])) next = { ...next, content };
    }
    return next;
  };
  return visit(content) as DocContent;
}

// ---- Doc sections ----

export interface DocSection {
  text: string;
  level: number;
  checks: number;
  done: number;
}

/** The doc's headings, each with the checkboxes under it (down to the next heading of the same or a higher level). */
export function docSections(content: DocContent | null | undefined): DocSection[] {
  const blocks = docBlocks(content, 5000);
  const sections: DocSection[] = [];
  blocks.forEach((block, at) => {
    if (block.kind !== "heading" || !block.text) return;
    const inside = sectionSlice(blocks, at);
    const checks = inside.filter((entry): entry is Extract<DocBlock, { kind: "check" }> => entry.kind === "check");
    sections.push({ text: block.text, level: block.level, checks: checks.length, done: checks.filter((check) => check.checked).length });
  });
  return sections;
}

function sectionSlice(blocks: DocBlock[], at: number): DocBlock[] {
  const head = blocks[at] as Extract<DocBlock, { kind: "heading" }>;
  let end = blocks.length;
  for (let i = at + 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.kind === "heading" && block.level <= head.level) {
      end = i;
      break;
    }
  }
  return blocks.slice(at + 1, end);
}

/** What a page card shows: the whole doc, or one section. `found` is false when the section's heading is gone. */
export function pickDocBlocks(content: DocContent | null | undefined, pick: Pick<DocPick, "section">, limit = 80): { blocks: DocBlock[]; found: boolean } {
  if (!pick.section) return { blocks: docBlocks(content, limit), found: true };
  const all = docBlocks(content, 5000);
  const at = all.findIndex((block) => block.kind === "heading" && block.text === pick.section);
  if (at < 0) return { blocks: docBlocks(content, limit), found: false };
  return { blocks: sectionSlice(all, at).slice(0, limit), found: true };
}

/** What a checklist card shows: every checkbox, or those in one section, numbered as `toggleDocCheck` counts them. */
export function pickDocChecks(content: DocContent | null | undefined, pick: Pick<DocPick, "section">): { checks: DocCheck[]; found: boolean } {
  const all = docChecks(content);
  if (!pick.section) return { checks: all, found: true };
  const { blocks, found } = pickDocBlocks(content, pick, 5000);
  if (!found) return { checks: all, found: false };
  const inSection = new Set(blocks.flatMap((block) => (block.kind === "check" ? [block.index] : [])));
  return { checks: all.filter((check) => inSection.has(check.index)), found: true };
}

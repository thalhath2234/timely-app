import type { SheetColumn, SheetConditionalFormat, SheetMerge, SheetRow } from "./sheetTypes";
import { adjustFormulaForStructure, renameSheetInFormula, scanFormulaRefs, shiftFormula, type StructureChange } from "./sheetRefs";
import { isFormulaValue, normalizeTypedCell, parseNumberInput } from "./sheetCell";
import { compareValues, isoDateSerial, serialToIso } from "./sheetValues";
import type { CellResult } from "./sheetFunctions";

/**
 * Pure grid edits shared by the web grid and the phone: inserting and deleting
 * rows or columns (formulas keep pointing at the same cells, in this tab and
 * every other), clipboard tables, pasting that grows the grid, smart sorting
 * and fill series.
 */

export type { StructureChange };

export interface GridState<R extends SheetRow = SheetRow, C extends SheetColumn = SheetColumn> {
  columns: C[];
  rows: R[];
  merges?: SheetMerge[];
  frozenRows?: number;
  frozenCols?: number;
  conditionalFormats?: SheetConditionalFormat[];
}

export const MAX_GRID_COLUMNS = 100;
export const MAX_GRID_ROWS = 5000;

type RowWithFormats = SheetRow & { formats?: Record<string, unknown> };

function mapFormulas<R extends SheetRow>(
  rows: R[],
  columns: SheetColumn[],
  rewrite: (value: string, row: number, col: number) => string,
): R[] {
  let changed = false;
  const next = rows.map((row, rowIndex) => {
    let cells: Record<string, string> | null = null;
    columns.forEach((column, colIndex) => {
      const value = row.cells?.[column.id];
      if (!value || !isFormulaValue(value)) return;
      const rewritten = rewrite(value, rowIndex, colIndex);
      if (rewritten === value) return;
      cells ??= { ...row.cells };
      cells[column.id] = rewritten;
    });
    if (!cells) return row;
    changed = true;
    return { ...row, cells };
  });
  return changed ? next : rows;
}

/** Rewrites formulas of another tab after rows or columns of `changedSheet` moved. */
export function adjustTabForStructure<T extends GridState & { name: string }>(
  tab: T,
  change: StructureChange,
  changedSheet: string,
): T {
  const rows = mapFormulas(tab.rows, tab.columns, (value, formulaRow, formulaCol) =>
    adjustFormulaForStructure(value, change, { changedSheet, formulaSheet: tab.name, formulaRow, formulaCol }),
  );
  return rows === tab.rows ? tab : { ...tab, rows };
}

/** Points every reference to a renamed tab at its new name, in every tab. */
export function renameSheetInTabs<T extends GridState>(tabs: T[], oldName: string, newName: string): T[] {
  if (oldName === newName) return tabs;
  return tabs.map((tab) => {
    const rows = mapFormulas(tab.rows, tab.columns, (value) => renameSheetInFormula(value, oldName, newName));
    return rows === tab.rows ? tab : { ...tab, rows };
  });
}

function shiftMerges(merges: SheetMerge[] | undefined, change: StructureChange): SheetMerge[] {
  const start = change.axis === "row" ? "startRow" : "startCol";
  const span = change.axis === "row" ? "rowSpan" : "colSpan";
  const out: SheetMerge[] = [];
  for (const merge of merges ?? []) {
    const first = merge[start];
    const last = first + merge[span] - 1;
    if (change.kind === "insert") {
      if (first >= change.at) out.push({ ...merge, [start]: first + change.count });
      else if (last >= change.at) out.push({ ...merge, [span]: merge[span] + change.count });
      else out.push(merge);
      continue;
    }
    const lastDeleted = change.at + change.count - 1;
    if (last < change.at) {
      out.push(merge);
    } else if (first > lastDeleted) {
      out.push({ ...merge, [start]: first - change.count });
    } else {
      // Shrink merges that only partly lose rows/columns; drop fully deleted ones.
      const keptBefore = Math.max(0, change.at - first);
      const keptAfter = Math.max(0, last - lastDeleted);
      const size = keptBefore + keptAfter;
      if (size <= 0) continue;
      const next = { ...merge, [start]: Math.min(first, change.at), [span]: size };
      if (next.colSpan > 1 || next.rowSpan > 1) out.push(next);
    }
  }
  return out;
}

function shiftFrozen(frozen: number | undefined, change: StructureChange): number | undefined {
  if (!frozen) return frozen;
  if (change.kind === "insert") return change.at < frozen ? frozen + change.count : frozen;
  const removed = Math.max(0, Math.min(frozen, change.at + change.count) - change.at);
  return frozen - removed;
}

/**
 * Inserts or deletes rows or columns in one tab and rewrites its own formulas.
 * `make` builds the new blank rows/columns. Other tabs need
 * `adjustTabForStructure` with the same change.
 */
export function applyStructureChange<G extends GridState & { name: string }>(
  grid: G,
  change: StructureChange,
  make: { row: (columns: SheetColumn[]) => G["rows"][number]; column: (index: number) => G["columns"][number] },
): G {
  if (change.count <= 0) return grid;
  // Formulas are adjusted at their old positions before anything moves.
  const adjusted = adjustTabForStructure(grid, change, grid.name);
  let { columns, rows } = adjusted;
  let conditionalFormats = grid.conditionalFormats;

  if (change.axis === "row") {
    rows = [...rows];
    if (change.kind === "insert") {
      const blanks = Array.from({ length: change.count }, () => make.row(columns));
      rows.splice(change.at, 0, ...blanks);
    } else {
      rows.splice(change.at, change.count);
    }
  } else if (change.kind === "insert") {
    const added = Array.from({ length: change.count }, (_, index) => make.column(change.at + index));
    columns = [...columns];
    columns.splice(change.at, 0, ...added);
    rows = rows.map((row) => {
      const cells = { ...row.cells };
      for (const column of added) cells[column.id] = "";
      return { ...row, cells };
    });
  } else {
    const removed = columns.slice(change.at, change.at + change.count);
    const removedIds = new Set(removed.map((column) => column.id));
    columns = columns.filter((column) => !removedIds.has(column.id));
    rows = rows.map((row) => {
      const cells = { ...row.cells };
      const formats = { ...((row as RowWithFormats).formats ?? {}) };
      for (const id of removedIds) {
        delete cells[id];
        delete formats[id];
      }
      return { ...row, cells, formats: Object.keys(formats).length ? formats : undefined };
    });
    conditionalFormats = conditionalFormats?.filter((rule) => !removedIds.has(rule.columnId));
  }

  return {
    ...adjusted,
    columns,
    rows,
    merges: shiftMerges(grid.merges, change),
    frozenRows: change.axis === "row" ? shiftFrozen(grid.frozenRows, change) : grid.frozenRows,
    frozenCols: change.axis === "col" ? shiftFrozen(grid.frozenCols, change) : grid.frozenCols,
    conditionalFormats,
  };
}

/**
 * Reads a clipboard table as spreadsheets write it: tab-separated, with
 * quoted cells that may hold tabs, newlines and "" escapes.
 */
export function parseClipboardTable(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (body === "") return [];
  const delimiter = "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;
  let atCellStart = true;
  while (index < body.length) {
    const char = body[index];
    if (atCellStart && char === '"') {
      // A quoted cell runs to the matching quote.
      let end = index + 1;
      let value = "";
      let closed = false;
      while (end < body.length) {
        if (body[end] === '"') {
          if (body[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          closed = true;
          end += 1;
          break;
        }
        value += body[end];
        end += 1;
      }
      const next = body[end];
      if (closed && (next === undefined || next === delimiter || next === "\n")) {
        cell = value;
        index = end;
        atCellStart = false;
        continue;
      }
      // Not a real quoted cell (e.g. 5" screen): keep the quote as text.
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else {
      cell += char;
      atCellStart = false;
    }
    index += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** A table as clipboard text other apps read: quotes cells with tabs, newlines or quotes. */
export function tableToClipboardText(table: string[][]): string {
  return table
    .map((line) =>
      line.map((value) => (/[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join("\t"),
    )
    .join("\n");
}

export interface PasteResult<G extends GridState> {
  grid: G;
  /** The pasted block, clipped to the grid limits. */
  rows: number;
  cols: number;
}

/**
 * Pastes a table at `origin`, adding rows and columns when it does not fit.
 * When the table was copied from this app (`source` is where it came from),
 * formulas shift like a fill so `=E2*G2` pasted one row down reads `=E3*G3`.
 */
export function pasteTable<G extends GridState>(
  grid: G,
  table: string[][],
  origin: { col: number; row: number },
  make: { row: (columns: SheetColumn[]) => G["rows"][number]; column: (index: number) => G["columns"][number] },
  source?: { col: number; row: number },
): PasteResult<G> {
  const height = Math.min(table.length, MAX_GRID_ROWS - origin.row);
  const width = Math.min(Math.max(0, ...table.map((line) => line.length)), MAX_GRID_COLUMNS - origin.col);
  if (height <= 0 || width <= 0) return { grid, rows: 0, cols: 0 };

  let columns = grid.columns;
  if (origin.col + width > columns.length) {
    columns = [...columns];
    while (columns.length < origin.col + width) columns.push(make.column(columns.length));
  }
  const rows = grid.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
  while (rows.length < origin.row + height) rows.push(make.row(columns));

  for (let r = 0; r < height; r += 1) {
    const row = rows[origin.row + r];
    for (let c = 0; c < width; c += 1) {
      const column = columns[origin.col + c];
      if (!column) continue;
      let value = table[r][c] ?? "";
      if (isFormulaValue(value)) {
        if (source) value = shiftFormula(value, origin.col - source.col, origin.row - source.row);
      } else {
        value = normalizeTypedCell(column.type, value);
      }
      row.cells[column.id] = value;
    }
  }
  return { grid: { ...grid, columns, rows }, rows: height, cols: width };
}

// ---- Sorting ----

function isBlankResult(result: CellResult) {
  return result.type === "empty" || (result.type === "text" && result.value.trim() === "");
}

/**
 * True for a summary row: it holds a formula that adds up a range of its
 * own column in this tab, like a total under a list. Sorting leaves it put.
 */
/**
 * Rows holding totals of the rows around them, for colour rules that compare a
 * value with the rest of its column. Undefined when no rule needs them.
 */
export function conditionalSummaryRows(
  rules: readonly SheetConditionalFormat[] | undefined,
  rows: SheetRow[],
  columns: SheetColumn[],
): Set<number> | undefined {
  if (!rules?.some((rule) => rule.operator === "aboveAverage" || rule.operator === "belowAverage" || rule.operator === "duplicate")) {
    return undefined;
  }
  const found = new Set<number>();
  rows.forEach((row, index) => {
    if (isSummaryRow(row, index, columns)) found.add(index);
  });
  return found;
}

export function isSummaryRow(row: SheetRow, rowIndex: number, columns: SheetColumn[]): boolean {
  return columns.some((column, colIndex) => {
    const value = row.cells?.[column.id];
    if (!value || !isFormulaValue(value)) return false;
    return scanFormulaRefs(value).some((ref) => {
      if (ref.sheet || !ref.to) return false;
      const fromCol = ref.from.col;
      const toCol = ref.to.col;
      const coversColumn =
        fromCol === undefined || toCol === undefined
          ? true
          : colIndex >= Math.min(fromCol, toCol) && colIndex <= Math.max(fromCol, toCol);
      const fromRow = ref.from.row ?? 0;
      const toRow = ref.to.row ?? Number.MAX_SAFE_INTEGER;
      const spansRows = Math.abs(toRow - fromRow) >= 1;
      const excludesSelf = rowIndex < Math.min(fromRow, toRow) || rowIndex > Math.max(fromRow, toRow);
      return coversColumn && spansRows && excludesSelf;
    });
  });
}

/**
 * Sorts rows by one column the way people expect: numbers and dates in
 * order, text A to Z ignoring case, blanks always last, and frozen header
 * or summary rows left where they are. Formulas in moved rows are rewritten
 * so `=E5*G5` still multiplies its own row. `rowRange` limits the sort to a
 * block of rows (a selection).
 */
export function sortGridRows<R extends SheetRow>(
  rows: R[],
  columns: SheetColumn[],
  colIndex: number,
  direction: "asc" | "desc",
  valueAt: (col: number, row: number) => CellResult,
  options: { frozenRows?: number; rowRange?: { start: number; end: number } } = {},
): R[] {
  const start = Math.max(options.frozenRows ?? 0, options.rowRange?.start ?? 0);
  const end = Math.min(rows.length - 1, options.rowRange?.end ?? rows.length - 1);
  if (end <= start) return rows;
  const movable: number[] = [];
  for (let index = start; index <= end; index += 1) {
    if (!isSummaryRow(rows[index], index, columns)) movable.push(index);
  }
  if (movable.length < 2) return rows;
  const keyed = movable.map((index) => ({ index, value: valueAt(colIndex, index) }));
  const sign = direction === "asc" ? 1 : -1;
  keyed.sort((left, right) => {
    const leftBlank = isBlankResult(left.value) || left.value.type === "error";
    const rightBlank = isBlankResult(right.value) || right.value.type === "error";
    if (leftBlank || rightBlank) {
      if (leftBlank && rightBlank) return left.index - right.index;
      return leftBlank ? 1 : -1;
    }
    return sign * compareValues(left.value, right.value) || left.index - right.index;
  });
  const next = [...rows];
  keyed.forEach(({ index: from }, order) => {
    const to = movable[order];
    const row = rows[from];
    next[to] =
      from === to
        ? row
        : (mapFormulas([row], columns, (value) => shiftFormula(value, 0, to - from))[0] as R);
  });
  return next;
}

// ---- Fill series ----

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function matchCase(sample: string, word: string) {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
  if (sample === sample.toLowerCase()) return word.toLowerCase();
  return word;
}

function cyclic(list: string[], value: string): { index: number; short: boolean } | null {
  const lower = value.trim().toLowerCase();
  const long = list.findIndex((item) => item.toLowerCase() === lower);
  if (long >= 0) return { index: long, short: false };
  const short = list.findIndex((item) => item.slice(0, 3).toLowerCase() === lower);
  return short >= 0 ? { index: short, short: true } : null;
}

/**
 * The values that continue `source` for `count` more cells. Numbers, dates,
 * month and weekday names and text ending in a number ("Item 1") count up by
 * the step between the source cells; anything else repeats. `backwards`
 * continues before the first cell instead (filling up or left).
 */
export function seriesValues(source: string[], count: number, backwards = false): string[] {
  const values = backwards ? [...source].reverse() : source;
  const n = values.length;
  const out: string[] = [];
  if (n === 0 || count <= 0) return out;
  const repeat = () => {
    for (let index = 0; index < count; index += 1) out.push(values[index % n]);
    return out;
  };
  if (values.some((value) => isFormulaValue(value) || value.trim() === "")) return repeat();

  const numbers = values.map((value) => (/^[-+]?[\d.,]+$/.test(value.trim()) ? parseNumberInput(value) : null));
  if (numbers.every((value) => value !== null)) {
    const list = numbers as number[];
    const step = n === 1 ? 1 : (list[n - 1] - list[0]) / (n - 1);
    const decimals = Math.max(...values.map((value) => (value.split(".")[1] ?? "").length));
    for (let index = 1; index <= count; index += 1) {
      const next = list[n - 1] + step * index;
      out.push(String(Number(next.toFixed(Math.min(10, Math.max(decimals, 0))))));
    }
    return out;
  }

  const serials = values.map((value) => isoDateSerial(value.trim()));
  if (serials.every((value) => value !== null) && values.every((value) => value.trim().length === 10)) {
    const list = serials as number[];
    const step = n === 1 ? 1 : Math.round((list[n - 1] - list[0]) / (n - 1));
    for (let index = 1; index <= count; index += 1) out.push(serialToIso(list[n - 1] + step * index));
    return out;
  }

  for (const list of [MONTHS_LONG, DAYS_LONG]) {
    const found = values.map((value) => cyclic(list, value));
    if (found.every((item) => item !== null)) {
      const items = found as { index: number; short: boolean }[];
      const step = n === 1 ? 1 : Math.round((items[n - 1].index - items[0].index) / (n - 1)) || 1;
      const sample = values[n - 1].trim();
      for (let index = 1; index <= count; index += 1) {
        const position = (((items[n - 1].index + step * index) % list.length) + list.length) % list.length;
        const word = items[n - 1].short ? list[position].slice(0, 3) : list[position];
        out.push(matchCase(sample, word));
      }
      return out;
    }
  }

  const numbered = values.map((value) => /^(.*?)(\d+)(\D*)$/.exec(value));
  if (
    numbered.every((match) => match !== null) &&
    numbered.every((match) => match![1] === numbered[0]![1] && match![3] === numbered[0]![3])
  ) {
    const list = numbered.map((match) => Number(match![2]));
    const step = n === 1 ? 1 : Math.round((list[n - 1] - list[0]) / (n - 1));
    const width = numbered[n - 1]![2].length;
    const padded = numbered[n - 1]![2].startsWith("0");
    for (let index = 1; index <= count; index += 1) {
      const next = Math.max(0, list[n - 1] + step * index);
      out.push(`${numbered[0]![1]}${padded ? String(next).padStart(width, "0") : next}${numbered[0]![3]}`);
    }
    return out;
  }

  return repeat();
}

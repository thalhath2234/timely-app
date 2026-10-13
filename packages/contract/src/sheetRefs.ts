/**
 * Reference-aware rewriting of formulas: fill/paste shifts, row and column
 * inserts or deletes, and tab renames. Everything here works on the formula
 * text, skips string literals, keeps `$` parts absolute and understands tab
 * prefixes such as `January!A1` and `'Jan 2026'!A1:B5`.
 */

/** "A" -> 0, "Z" -> 25, "AA" -> 26 */
export function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function columnIndexToLetter(index: number): string {
  let result = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

/** One side of a reference. A whole column has no row; a whole row no column. */
export interface RefEndpoint {
  col?: number;
  row?: number;
  colAbs: boolean;
  rowAbs: boolean;
}

export interface FormulaRef {
  /** Offsets of the whole reference (tab prefix included) in the formula. */
  start: number;
  end: number;
  sheet: string | null;
  /** The tab prefix exactly as written (`January!`, `'Jan 2026'!`), or "". */
  prefix: string;
  from: RefEndpoint;
  to: RefEndpoint | null;
}

const ENDPOINT = String.raw`\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}|\$?\d+`;
const RANGE_RE = new RegExp(`(${ENDPOINT})\\s*:\\s*(${ENDPOINT})`, "y");
const CELL_RE = /\$?[A-Za-z]{1,3}\$?\d+/y;
const UNQUOTED_SHEET_RE = /[\p{L}_][\p{L}\p{N}_.]*!/uy;
const WORD_CHAR = /[\p{L}\p{N}_.$']/u;
const AFTER_REF_CHAR = /[\p{L}\p{N}_(!.]/u;

function parseEndpoint(text: string): RefEndpoint | null {
  const match = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(text);
  if (!match || (!match[2] && !match[4])) return null;
  const endpoint: RefEndpoint = { colAbs: false, rowAbs: false };
  if (match[2]) {
    endpoint.col = columnLetterToIndex(match[2]);
    endpoint.colAbs = match[1] === "$";
    endpoint.rowAbs = match[3] === "$";
  } else {
    endpoint.rowAbs = match[1] === "$" || match[3] === "$";
  }
  if (match[4]) endpoint.row = Number(match[4]) - 1;
  return endpoint;
}

export function formatEndpoint(endpoint: RefEndpoint): string {
  let out = "";
  if (endpoint.col !== undefined) {
    out += `${endpoint.colAbs ? "$" : ""}${columnIndexToLetter(endpoint.col)}`;
  }
  if (endpoint.row !== undefined) {
    out += `${endpoint.rowAbs ? "$" : ""}${endpoint.row + 1}`;
  }
  return out;
}

/** True when a tab name can be written without quotes, e.g. January but not 'Jan 2026' or 'Q1'. */
function bareSheetName(name: string) {
  return (
    /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) &&
    !/^[A-Za-z]{1,3}\d+$/.test(name) &&
    !/^(TRUE|FALSE)$/i.test(name)
  );
}

/** The prefix that addresses a tab: `January!` or `'Jan 2026'!`. */
export function sheetPrefix(name: string): string {
  return bareSheetName(name) ? `${name}!` : `'${name.replace(/'/g, "''")}'!`;
}

export function formatRef(ref: Pick<FormulaRef, "sheet" | "from" | "to"> & { prefix?: string }): string {
  const body = ref.to
    ? `${formatEndpoint(ref.from)}:${formatEndpoint(ref.to)}`
    : formatEndpoint(ref.from);
  if (ref.prefix !== undefined) return ref.prefix + body;
  return ref.sheet ? `${sheetPrefix(ref.sheet)}${body}` : body;
}

/** Skips a "string" (with "" escapes) starting at index; returns the index after it. */
function skipString(formula: string, index: number): number {
  let i = index + 1;
  while (i < formula.length) {
    if (formula[i] === '"') {
      if (formula[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return i;
}

function readSheetPrefix(formula: string, index: number): { name: string; next: number } | null {
  if (formula[index] === "'") {
    let i = index + 1;
    let name = "";
    while (i < formula.length) {
      if (formula[i] === "'") {
        if (formula[i + 1] === "'") {
          name += "'";
          i += 2;
          continue;
        }
        break;
      }
      name += formula[i];
      i += 1;
    }
    if (formula[i] === "'" && formula[i + 1] === "!" && name) return { name, next: i + 2 };
    return null;
  }
  UNQUOTED_SHEET_RE.lastIndex = index;
  const match = UNQUOTED_SHEET_RE.exec(formula);
  if (!match) return null;
  return { name: match[0].slice(0, -1), next: index + match[0].length };
}

/** Every cell or range reference in a formula, in order. */
export function scanFormulaRefs(formula: string): FormulaRef[] {
  const refs: FormulaRef[] = [];
  if (!formula.trim().startsWith("=")) return refs;
  let i = formula.indexOf("=") + 1;
  while (i < formula.length) {
    const char = formula[i];
    if (char === '"') {
      i = skipString(formula, i);
      continue;
    }
    const before = i > 0 ? formula[i - 1] : "";
    if (before && WORD_CHAR.test(before)) {
      i += 1;
      continue;
    }
    const prefix = readSheetPrefix(formula, i);
    const at = prefix ? prefix.next : i;
    RANGE_RE.lastIndex = at;
    const range = RANGE_RE.exec(formula);
    if (range && !AFTER_REF_CHAR.test(formula[at + range[0].length] ?? "")) {
      const from = parseEndpoint(range[1]);
      const to = parseEndpoint(range[2]);
      if (from && to) {
        refs.push({ start: i, end: at + range[0].length, sheet: prefix?.name ?? null, prefix: formula.slice(i, at), from, to });
        i = at + range[0].length;
        continue;
      }
    }
    CELL_RE.lastIndex = at;
    const cell = CELL_RE.exec(formula);
    if (cell && !AFTER_REF_CHAR.test(formula[at + cell[0].length] ?? "")) {
      const from = parseEndpoint(cell[0]);
      if (from) {
        refs.push({ start: i, end: at + cell[0].length, sheet: prefix?.name ?? null, prefix: formula.slice(i, at), from, to: null });
        i = at + cell[0].length;
        continue;
      }
    }
    // Skip the rest of a word (function names, TRUE) or a quoted tab name.
    if (prefix) {
      i = prefix.next;
      continue;
    }
    i += 1;
  }
  return refs;
}

function rewriteRefs(
  formula: string,
  rewrite: (ref: FormulaRef) => string | null,
): string {
  const refs = scanFormulaRefs(formula);
  if (refs.length === 0) return formula;
  let out = "";
  let last = 0;
  let changed = false;
  for (const ref of refs) {
    const next = rewrite(ref);
    if (next === null) continue;
    out += formula.slice(last, ref.start) + next;
    last = ref.end;
    changed = true;
  }
  return changed ? out + formula.slice(last) : formula;
}

/** Shift relative references when filling or pasting a formula. `$` parts stay put. */
export function shiftFormula(value: string, deltaCol: number, deltaRow: number): string {
  if (!value.trim().startsWith("=") || (deltaCol === 0 && deltaRow === 0)) return value;
  const shift = (endpoint: RefEndpoint): RefEndpoint => ({
    ...endpoint,
    col:
      endpoint.col === undefined || endpoint.colAbs
        ? endpoint.col
        : Math.max(0, endpoint.col + deltaCol),
    row:
      endpoint.row === undefined || endpoint.rowAbs
        ? endpoint.row
        : Math.max(0, endpoint.row + deltaRow),
  });
  return rewriteRefs(value, (ref) =>
    formatRef({ ...ref, from: shift(ref.from), to: ref.to ? shift(ref.to) : null }),
  );
}

export interface StructureChange {
  kind: "insert" | "delete";
  axis: "row" | "col";
  /** First row/column index (0-based) inserted or deleted. */
  at: number;
  count: number;
}

export interface AdjustContext {
  /** Name of the tab whose rows/columns changed. */
  changedSheet: string;
  /** Name of the tab the formula lives in. */
  formulaSheet: string;
  /** Position of the formula's cell before the change (0-based). */
  formulaRow?: number;
  formulaCol?: number;
}

const sameSheet = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Rewrites references after rows or columns are inserted or deleted so they
 * keep pointing at the same cells. Ranges grow when rows land inside them, and
 * a total right below its range (`=SUM(D2:D9)` on row 10) also grows when a row
 * is inserted directly above it. References to deleted cells become #REF!.
 */
export function adjustFormulaForStructure(
  value: string,
  change: StructureChange,
  context: AdjustContext,
): string {
  if (!value.trim().startsWith("=") || change.count <= 0) return value;
  const key = change.axis === "row" ? "row" : "col";
  const position = change.axis === "row" ? context.formulaRow : context.formulaCol;
  const lastDeleted = change.at + change.count - 1;

  return rewriteRefs(value, (ref) => {
    const target = ref.sheet ?? context.formulaSheet;
    if (!sameSheet(target, context.changedSheet)) return null;
    const from = { ...ref.from };
    const to = ref.to ? { ...ref.to } : null;
    const a = from[key];
    const b = to ? to[key] : undefined;

    if (change.kind === "insert") {
      if (!to) {
        if (a === undefined || a < change.at) return null;
        from[key] = a + change.count;
        return formatRef({ ...ref, from, to });
      }
      if (a === undefined && b === undefined) return null;
      if (a === undefined || b === undefined) {
        // Open ranges (D2:D) only move their fixed side.
        const endpoint = a === undefined ? to : from;
        if (endpoint[key]! < change.at) return null;
        endpoint[key] = endpoint[key]! + change.count;
        return formatRef({ ...ref, from, to });
      }
      const lowEndpoint = a <= b ? from : to;
      const highEndpoint = a <= b ? to : from;
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const local = !ref.sheet || sameSheet(ref.sheet, context.formulaSheet);
      if (low >= change.at) {
        lowEndpoint[key] = low + change.count;
        highEndpoint[key] = high + change.count;
      } else if (high >= change.at) {
        highEndpoint[key] = high + change.count;
      } else if (local && high === change.at - 1 && position !== undefined && position >= change.at) {
        highEndpoint[key] = high + change.count;
      } else {
        return null;
      }
      return formatRef({ ...ref, from, to });
    }

    // Delete
    if (!to) {
      if (a === undefined || a < change.at) return null;
      if (a <= lastDeleted) return "#REF!";
      from[key] = a - change.count;
      return formatRef({ ...ref, from, to });
    }
    if (a === undefined || b === undefined) {
      // Open ranges (D2:D) or whole rows/columns: only the given side moves.
      const endpoint = a === undefined ? to : from;
      const coordinate = endpoint[key]!;
      if (coordinate < change.at) return null;
      endpoint[key] = coordinate <= lastDeleted ? change.at : coordinate - change.count;
      return formatRef({ ...ref, from, to });
    }
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    if (high < change.at) return null;
    const nextLow = low > lastDeleted ? low - change.count : low >= change.at ? change.at : low;
    const nextHigh = high > lastDeleted ? high - change.count : change.at - 1;
    if (nextHigh < nextLow) return "#REF!";
    const lowEndpoint = a <= b ? from : to;
    const highEndpoint = a <= b ? to : from;
    lowEndpoint[key] = nextLow;
    highEndpoint[key] = nextHigh;
    return formatRef({ ...ref, from, to });
  });
}

/** Points `'Old name'!A1` style references at a renamed tab. */
export function renameSheetInFormula(value: string, oldName: string, newName: string): string {
  if (!value.trim().startsWith("=") || oldName === newName) return value;
  return rewriteRefs(value, (ref) =>
    ref.sheet && sameSheet(ref.sheet, oldName)
      ? formatRef({ sheet: newName, from: ref.from, to: ref.to })
      : null,
  );
}

/** True when the formula reads any cell of the named tab. */
export function formulaReadsSheet(value: string, sheet: string): boolean {
  return scanFormulaRefs(value).some((ref) => ref.sheet !== null && sameSheet(ref.sheet, sheet));
}

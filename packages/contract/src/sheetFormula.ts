import type { SheetColumn, SheetRow } from "./sheetTypes";
import { columnIndexToLetter, columnLetterToIndex, shiftFormula } from "./sheetRefs";
import {
  callFunction,
  EMPTY,
  error,
  isError,
  isRange,
  makeRange,
  single,
  toNumber,
  toText,
  type CellResult,
  type EvalValue,
} from "./sheetFunctions";
import { compareValues, isoDateSerial, serialToIso } from "./sheetValues";

export type { CellResult, RangeValue } from "./sheetFunctions";
export { columnIndexToLetter, columnLetterToIndex, shiftFormula };

export function formatCellResult(result: CellResult): string {
  if (result.type === "number") {
    return Number.isFinite(result.value)
      ? String(Math.round(result.value * 1e10) / 1e10)
      : "#NUM!";
  }
  return toText(result);
}

// ---- Tokenizer ----

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "error"; value: string }
  | { kind: "ref"; col: number; row: number }
  | { kind: "sheet"; name: string }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" }
  | { kind: "colon" };

const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%"];
const ERROR_LITERALS = ["#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!", "#CYCLE!"];

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let position = 0;

  while (position < input.length) {
    const char = input[position];

    if (/\s/.test(char) || char === "$") {
      // `$` only marks absolute references; it does not change the value.
      position += 1;
      continue;
    }

    if (char === '"') {
      let value = "";
      position += 1;
      for (;;) {
        if (position >= input.length) return "#PARSE!";
        if (input[position] === '"') {
          if (input[position + 1] === '"') {
            value += '"';
            position += 2;
            continue;
          }
          break;
        }
        value += input[position];
        position += 1;
      }
      position += 1;
      tokens.push({ kind: "string", value });
      continue;
    }

    if (char === "'") {
      let name = "";
      position += 1;
      for (;;) {
        if (position >= input.length) return "#PARSE!";
        if (input[position] === "'") {
          if (input[position + 1] === "'") {
            name += "'";
            position += 2;
            continue;
          }
          break;
        }
        name += input[position];
        position += 1;
      }
      position += 1;
      if (input[position] !== "!") return "#PARSE!";
      position += 1;
      tokens.push({ kind: "sheet", name });
      continue;
    }

    if (char === "#") {
      const literal = ERROR_LITERALS.find((candidate) =>
        input.toUpperCase().startsWith(candidate, position),
      );
      if (!literal) return "#PARSE!";
      tokens.push({ kind: "error", value: literal });
      position += literal.length;
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(input[position + 1] ?? ""))) {
      const match = /^(\d*\.?\d+|\d+\.)(e[-+]?\d+)?/i.exec(input.slice(position))!;
      const value = Number(match[0]);
      if (Number.isNaN(value)) return "#NUM!";
      tokens.push({ kind: "number", value });
      position += match[0].length;
      continue;
    }

    if (/[\p{L}_]/u.test(char)) {
      let raw = "";
      while (position < input.length && /[\p{L}\p{N}_.$]/u.test(input[position])) {
        if (input[position] !== "$") raw += input[position];
        position += 1;
      }
      if (input[position] === "!") {
        position += 1;
        tokens.push({ kind: "sheet", name: raw });
        continue;
      }
      const refMatch = /^([A-Za-z]{1,3})([0-9]+)$/.exec(raw);
      if (refMatch) {
        tokens.push({
          kind: "ref",
          col: columnLetterToIndex(refMatch[1]),
          row: Number(refMatch[2]) - 1,
        });
      } else {
        tokens.push({ kind: "identifier", value: raw.toUpperCase() });
      }
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char });
      position += 1;
      continue;
    }

    if (char === "," || char === ";") {
      tokens.push({ kind: "comma" });
      position += 1;
      continue;
    }

    if (char === ":") {
      tokens.push({ kind: "colon" });
      position += 1;
      continue;
    }

    const operator = OPERATORS.find((candidate) => input.startsWith(candidate, position));
    if (operator) {
      tokens.push({ kind: "operator", value: operator });
      position += operator.length;
      continue;
    }

    return "#PARSE!";
  }

  return tokens;
}

// ---- Operators ----

function isDateText(result: CellResult) {
  return result.type === "text" && isoDateSerial(result.value) !== null;
}

function applyScalar(operator: string, left: CellResult, right: CellResult): CellResult {
  if (isError(left)) return left;
  if (isError(right)) return right;

  if (operator === "&") {
    return { type: "text", value: toText(left) + toText(right) };
  }

  if (["=", "<>", "<", ">", "<=", ">="].includes(operator)) {
    const order = compareValues(left, right);
    switch (operator) {
      case "=":
        return { type: "boolean", value: order === 0 };
      case "<>":
        return { type: "boolean", value: order !== 0 };
      case "<":
        return { type: "boolean", value: order < 0 };
      case ">":
        return { type: "boolean", value: order > 0 };
      case "<=":
        return { type: "boolean", value: order <= 0 };
      default:
        return { type: "boolean", value: order >= 0 };
    }
  }

  const leftNumber = toNumber(left);
  if (typeof leftNumber !== "number") return leftNumber;
  const rightNumber = toNumber(right);
  if (typeof rightNumber !== "number") return rightNumber;

  // Dates stay dates: a date plus days is a date, a date minus a date is days.
  const leftDate = isDateText(left);
  const rightDate = isDateText(right);
  switch (operator) {
    case "+":
      if (leftDate !== rightDate) {
        return { type: "text", value: serialToIso(leftNumber + rightNumber) };
      }
      return { type: "number", value: leftNumber + rightNumber };
    case "-":
      if (leftDate && !rightDate) {
        return { type: "text", value: serialToIso(leftNumber - rightNumber) };
      }
      return { type: "number", value: leftNumber - rightNumber };
    case "*":
      return { type: "number", value: leftNumber * rightNumber };
    case "/":
      return rightNumber === 0
        ? error("#DIV/0!")
        : { type: "number", value: leftNumber / rightNumber };
    case "^": {
      const value = leftNumber ** rightNumber;
      return Number.isFinite(value) ? { type: "number", value } : error("#NUM!");
    }
    default:
      return error("#PARSE!");
  }
}

/** Arithmetic and comparisons work element by element on ranges, so
 * SUMPRODUCT((C2:C9="Food")*D2:D9) does what it does in other spreadsheets. */
function applyBinary(operator: string, left: EvalValue, right: EvalValue): EvalValue {
  if (!isRange(left) && !isRange(right)) return applyScalar(operator, left, right);
  const shape = isRange(left) ? left : (right as ReturnType<typeof makeRange>);
  const at = (value: EvalValue, index: number) =>
    isRange(value) ? (value[index] ?? EMPTY) : value;
  const cells = shape.map((_, index) => applyScalar(operator, at(left, index), at(right, index)));
  return makeRange(cells, shape.rows, shape.cols);
}

function mapRange(value: EvalValue, map: (cell: CellResult) => CellResult): EvalValue {
  if (!isRange(value)) return map(value);
  return makeRange(value.map(map), value.rows, value.cols);
}

// ---- Parser ----

export interface FormulaContext {
  /** Reads one cell; `sheet` is a tab name or undefined for this tab. */
  lookup: (sheet: string | undefined, col: number, row: number) => CellResult;
  /** Grid size of a tab, or null when no tab has that name. */
  size: (sheet: string | undefined) => { columns: number; rows: number } | null;
  /** The cell being evaluated, for ROW() and COLUMN(). */
  row: number;
  col: number;
}

function parseFormula(tokens: Token[], context: FormulaContext): CellResult {
  let position = 0;

  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isOperator = (values: string[]) => {
    const token = peek();
    return token?.kind === "operator" && values.includes(token.value);
  };

  function parseExpression(): EvalValue {
    let left = parseConcat();
    while (isOperator(["=", "<>", "<", ">", "<=", ">="])) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, left, parseConcat());
    }
    return left;
  }

  function parseConcat(): EvalValue {
    let left = parseAdditive();
    while (isOperator(["&"])) {
      next();
      left = applyBinary("&", left, parseAdditive());
    }
    return left;
  }

  function parseAdditive(): EvalValue {
    let left = parseMultiplicative();
    while (isOperator(["+", "-"])) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, left, parseMultiplicative());
    }
    return left;
  }

  function parseMultiplicative(): EvalValue {
    let left = parsePower();
    while (isOperator(["*", "/"])) {
      const operator = (next() as { value: string }).value;
      left = applyBinary(operator, left, parsePower());
    }
    return left;
  }

  function parsePower(): EvalValue {
    let left = parseUnary();
    // Spreadsheets evaluate ^ left to right: 2^3^2 is 64.
    while (isOperator(["^"])) {
      next();
      left = applyBinary("^", left, parseUnary());
    }
    return left;
  }

  function parseUnary(): EvalValue {
    const token = peek();
    if (token?.kind === "operator" && (token.value === "-" || token.value === "+")) {
      next();
      const operand = parseUnary();
      return mapRange(operand, (cell) => {
        if (isError(cell)) return cell;
        const numeric = toNumber(cell);
        if (typeof numeric !== "number") return numeric;
        return { type: "number", value: token.value === "-" ? -numeric : numeric };
      });
    }
    return parsePostfix();
  }

  /** Postfix percent, spreadsheet style: `50%` is 0.5, `A1%%` is A1/10000. */
  function parsePostfix(): EvalValue {
    let value = parsePrimary();
    while (isOperator(["%"])) {
      next();
      value = mapRange(value, (cell) => {
        if (isError(cell)) return cell;
        const numeric = toNumber(cell);
        if (typeof numeric !== "number") return numeric;
        return { type: "number", value: numeric / 100 };
      });
    }
    return value;
  }

  function parseReference(first: Token, sheet: string | undefined): EvalValue {
    const size = context.size(sheet);
    if (!size) {
      // Consume the rest of a range so parsing can continue.
      if (peek()?.kind === "colon") {
        next();
        next();
      }
      return error("#REF!");
    }

    if (peek()?.kind === "colon") {
      next();
      let end = next();
      if (end?.kind === "sheet") end = next();
      // Missing row/column coordinates expand to the current grid boundary.
      // Re-evaluation against a larger grid includes newly added rows/columns.
      const endpoint = (part: Token | undefined): { col?: number; row?: number } | null => {
        if (part?.kind === "ref") return { col: part.col, row: part.row };
        if (part?.kind === "identifier" && /^[A-Z]{1,3}$/.test(part.value))
          return { col: columnLetterToIndex(part.value) };
        if (part?.kind === "number" && Number.isSafeInteger(part.value))
          return { row: part.value - 1 };
        return null;
      };
      const start = endpoint(first);
      const finish = endpoint(end);
      if (!start || !finish) return error("#PARSE!");
      if (
        (start.col === undefined && finish.row === undefined) ||
        (start.row === undefined && finish.col === undefined)
      )
        return error("#PARSE!");
      for (const coordinate of [start.col, start.row, finish.col, finish.row]) {
        if (coordinate !== undefined && (!Number.isSafeInteger(coordinate) || coordinate < 0))
          return error("#REF!");
      }
      const left = start.col ?? 0;
      const right = finish.col ?? size.columns - 1;
      const top = start.row ?? 0;
      const bottom = finish.row ?? size.rows - 1;
      // Only visit actual grid cells, even for very large explicit bounds.
      const startCol = Math.max(0, Math.min(left, right));
      const endCol = Math.min(size.columns - 1, Math.max(left, right));
      const startRow = Math.max(0, Math.min(top, bottom));
      const endRow = Math.min(size.rows - 1, Math.max(top, bottom));
      // An open range starting beyond the grid is empty, not reversed.
      if (
        (finish.row === undefined && top >= size.rows) ||
        (finish.col === undefined && left >= size.columns)
      )
        return makeRange([], 0, 0);
      const cells: CellResult[] = [];
      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = startCol; col <= endCol; col += 1) cells.push(context.lookup(sheet, col, row));
      }
      return makeRange(cells, Math.max(0, endRow - startRow + 1), Math.max(0, endCol - startCol + 1));
    }

    if (first.kind === "ref") return context.lookup(sheet, first.col, first.row);
    return error("#PARSE!");
  }

  function parsePrimary(): EvalValue {
    let token = next();
    if (!token) return error("#PARSE!");

    if (token.kind === "sheet") {
      const sheet = token.name;
      token = next();
      if (!token) return error("#PARSE!");
      return parseReference(token, sheet);
    }

    if (peek()?.kind === "colon") return parseReference(token, undefined);

    if (token.kind === "number") return { type: "number", value: token.value };
    if (token.kind === "string") return { type: "text", value: token.value };
    if (token.kind === "error") return error(token.value);
    if (token.kind === "ref") return parseReference(token, undefined);

    if (token.kind === "identifier") {
      const open = peek();
      if (open?.kind !== "paren" || open.value !== "(") {
        if (token.value === "TRUE") return { type: "boolean", value: true };
        if (token.value === "FALSE") return { type: "boolean", value: false };
        return error("#NAME?");
      }
      next();

      const args: EvalValue[] = [];
      if (!(peek()?.kind === "paren" && (peek() as { value: string }).value === ")")) {
        args.push(parseArgument());
        while (peek()?.kind === "comma") {
          next();
          args.push(parseArgument());
        }
      }

      const closing = next();
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        return error("#PARSE!");
      }

      return callFunction(token.value, args, context);
    }

    if (token.kind === "paren" && token.value === "(") {
      const value = parseExpression();
      const closing = next();
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        return error("#PARSE!");
      }
      return value;
    }

    return error("#PARSE!");
  }

  /** An omitted argument such as the middle of IF(A1,,"no") reads as empty. */
  function parseArgument(): EvalValue {
    const token = peek();
    if (token?.kind === "comma" || (token?.kind === "paren" && token.value === ")")) return EMPTY;
    return parseExpression();
  }

  const result = parseExpression();
  if (position < tokens.length) return error("#PARSE!");
  return single(result);
}

function parseLiteral(raw: string): CellResult {
  const trimmed = raw.trim();
  if (trimmed === "") return EMPTY;

  const upper = trimmed.toUpperCase();
  if (upper === "TRUE") return { type: "boolean", value: true };
  if (upper === "FALSE") return { type: "boolean", value: false };

  // Accept "1,234.5" and "42%" as numbers, everything else stays text.
  const numericCandidate = trimmed.replace(/,/g, "");
  if (/^-?\d*\.?\d+%$/.test(numericCandidate)) {
    return { type: "number", value: Number(numericCandidate.slice(0, -1)) / 100 };
  }
  if (/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(numericCandidate)) {
    return { type: "number", value: Number(numericCandidate) };
  }

  return { type: "text", value: trimmed };
}

export interface WorkbookTab {
  id: string;
  name: string;
  columns: SheetColumn[];
  rows: SheetRow[];
}

export interface WorkbookContext {
  /** Every tab of the workbook, including the one being evaluated. */
  tabs: WorkbookTab[];
  /** Id of the tab whose columns/rows are passed to createSheetEvaluator. */
  currentTabId?: string;
}

export interface SheetEvaluator {
  valueAt: (col: number, row: number) => CellResult;
  displayAt: (col: number, row: number) => string;
  isFormula: (col: number, row: number) => boolean;
}

type Registry = Map<string, SheetEvaluator & { name: string; warm: () => void }>;

interface Shared {
  registry: Registry;
  /** Formula evaluations in progress across every tab of the workbook. */
  depth: number;
}

/**
 * Builds a memoized evaluator over the grid. Formulas may reference other
 * cells by A1 notation and other tabs of the workbook by name
 * (`January!F2`, `'Jan 2026'!F2:F40`); circular references resolve to
 * #CYCLE! instead of recursing forever.
 */
export function createSheetEvaluator(
  columns: SheetColumn[],
  rows: SheetRow[],
  workbook?: WorkbookContext,
): SheetEvaluator {
  const shared: Shared = { registry: new Map(), depth: 0 };
  const currentName =
    workbook?.tabs.find((tab) => tab.id === workbook.currentTabId)?.name ?? "";
  return buildEvaluator(columns, rows, currentName, workbook, shared, workbook?.currentTabId);
}

function buildEvaluator(
  columns: SheetColumn[],
  rows: SheetRow[],
  name: string,
  workbook: WorkbookContext | undefined,
  shared: Shared,
  id: string | undefined,
): SheetEvaluator & { name: string; warm: () => void } {
  const registry = shared.registry;
  const cache = new Map<number, CellResult>();
  const visiting = new Set<number>();
  const width = Math.max(columns.length, 1);
  let warmed = false;

  const rawAt = (col: number, row: number): string => {
    const column = columns[col];
    const sheetRow = rows[row];
    if (!column || !sheetRow) return "";
    return sheetRow.cells?.[column.id] ?? "";
  };

  const resolveTab = (sheet: string | undefined) => {
    if (sheet === undefined) return self;
    const key = sheet.trim().toLowerCase();
    if (name && key === name.trim().toLowerCase()) return self;
    const tab = workbook?.tabs.find((candidate) => candidate.name.trim().toLowerCase() === key);
    if (!tab) return null;
    const existing = registry.get(tab.id);
    if (existing) return existing;
    const built = buildEvaluator(tab.columns, tab.rows, tab.name, workbook, shared, tab.id);
    registry.set(tab.id, built);
    return built;
  };

  const sizeOf = (sheet: string | undefined) => {
    if (sheet === undefined) return { columns: columns.length, rows: rows.length };
    const key = sheet.trim().toLowerCase();
    if (name && key === name.trim().toLowerCase()) return { columns: columns.length, rows: rows.length };
    const tab = workbook?.tabs.find((candidate) => candidate.name.trim().toLowerCase() === key);
    return tab ? { columns: tab.columns.length, rows: tab.rows.length } : null;
  };

  const compute = (col: number, row: number): CellResult => {
    const key = row * width + col;
    const cached = cache.get(key);
    if (cached) return cached;
    if (col >= columns.length || row >= rows.length || col < 0 || row < 0) return EMPTY;
    if (visiting.has(key)) return error("#CYCLE!");

    const raw = rawAt(col, row).trim();
    if (!raw.startsWith("=")) {
      const literal = parseLiteral(raw);
      cache.set(key, literal);
      return literal;
    }

    visiting.add(key);
    shared.depth += 1;
    let result: CellResult;
    try {
      const tokens = tokenize(raw.slice(1));
      result =
        typeof tokens === "string"
          ? error(tokens)
          : parseFormula(tokens, {
              lookup: (sheet, c, r) => {
                const target = resolveTab(sheet);
                return target ? target.valueAt(c, r) : error("#REF!");
              },
              size: sizeOf,
              row,
              col,
            });
    } catch (caught) {
      if (!(caught instanceof RangeError)) throw caught;
      result = error("#DEPTH!");
    } finally {
      shared.depth -= 1;
      visiting.delete(key);
    }

    cache.set(key, result);
    return result;
  };

  /** Long chains such as a running balance are evaluated top to bottom first,
   * so reading the last row does not recurse through every row above it.
   * Warming only starts when no formula anywhere is mid-evaluation, so a cell
   * that is being computed is never mistaken for a cycle. */
  const warm = () => {
    if (warmed) return;
    warmed = true;
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < columns.length; col += 1) {
        if (rawAt(col, row).trim().startsWith("=")) compute(col, row);
      }
    }
  };

  const valueAt = (col: number, row: number): CellResult => {
    if (!warmed && shared.depth === 0 && rawAt(col, row).trim().startsWith("=")) {
      const cached = cache.get(row * width + col);
      if (cached) return cached;
      // Other tabs first, so totals read from them are already known.
      for (const tab of workbook?.tabs ?? []) {
        if (tab.id === id) continue;
        resolveTab(tab.name)?.warm();
      }
      warm();
    }
    return compute(col, row);
  };

  const self = {
    name,
    warm,
    valueAt,
    displayAt: (col: number, row: number) => formatCellResult(valueAt(col, row)),
    isFormula: (col: number, row: number) => rawAt(col, row).trim().startsWith("="),
  };
  if (id) registry.set(id, self);
  return self;
}

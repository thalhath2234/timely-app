export interface FormulaRefSpan {
  start: number;
  end: number;
}

const REF_RE =
  /(?<![A-Za-z0-9_])(?:\$?[A-Za-z]+(?:\$?\d+)?|\$?\d+)\s*:\s*(?:\$?[A-Za-z]+(?:\$?\d+)?|\$?\d+)(?![A-Za-z0-9_])|\$?[A-Za-z]+\$?\d+/g;
const TRAILING_NAME_RE = /[A-Za-z_][A-Za-z0-9_.]*$/;
const A1_REF_RE = /^\$?[A-Za-z]+\$?\d+$/;
const ARG_BREAK_RE = /[+\-*/&^<>=,(]$/;

function quotedMask(formula: string): boolean[] {
  const mask = new Array<boolean>(formula.length).fill(false);
  let inString = false;
  for (let index = 0; index < formula.length; index += 1) {
    if (formula[index] === '"') {
      inString = !inString;
      continue;
    }
    mask[index] = inString;
  }
  return mask;
}

export function findFormulaRefAt(
  formula: string,
  caret: number,
): FormulaRefSpan | null {
  const quoted = quotedMask(formula);
  REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null = REF_RE.exec(formula);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (!quoted[start] && caret >= start && caret <= end) {
      return { start, end };
    }
    match = REF_RE.exec(formula);
  }
  return null;
}

/** Close unquoted parentheses so `=SUM(A1:A5` commits as `=SUM(A1:A5)`. */
export function closeOpenParens(formula: string): string {
  const quoted = quotedMask(formula);
  let balance = 0;
  for (let index = 0; index < formula.length; index += 1) {
    if (quoted[index]) continue;
    if (formula[index] === "(") balance += 1;
    else if (formula[index] === ")") balance -= 1;
  }
  if (balance <= 0) return formula;
  return formula + ")".repeat(balance);
}

function needsCommaBefore(formula: string, from: number, to: number): boolean {
  const inner = formula.slice(from, to).trim();
  if (!inner) return false;
  return !ARG_BREAK_RE.test(inner);
}

interface InsertSite {
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

function findParenPairAt(
  formula: string,
  caret: number,
): { open: number; close: number } | null {
  const quoted = quotedMask(formula);
  const stack: number[] = [];
  let containing: { open: number; close: number } | null = null;
  let lastClosed: { open: number; close: number } | null = null;

  for (let index = 0; index < formula.length; index += 1) {
    if (quoted[index]) continue;
    if (formula[index] === "(") {
      stack.push(index);
      continue;
    }
    if (formula[index] !== ")") continue;
    const open = stack.pop();
    if (open == null) continue;
    const pair = { open, close: index };
    lastClosed = pair;
    if (caret >= open && caret <= index + 1) {
      if (!containing || open > containing.open) {
        containing = pair;
      }
    }
  }

  if (containing) return containing;

  const unclosed = stack[stack.length - 1];
  if (unclosed != null && caret > unclosed) {
    return { open: unclosed, close: formula.length };
  }

  if (
    lastClosed &&
    caret >= lastClosed.close &&
    lastClosed.close === formula.length - 1
  ) {
    return lastClosed;
  }

  return null;
}

function findInsertSite(formula: string, caret: number): InsertSite {
  const clamped = Math.max(0, Math.min(caret, formula.length));
  const pair = findParenPairAt(formula, clamped);
  if (pair) {
    const inner = formula.slice(pair.open + 1, pair.close).trim();
    if (!inner) {
      return { start: pair.open + 1, end: pair.close, prefix: "", suffix: "" };
    }
    if (clamped >= pair.close) {
      return { start: pair.close, end: pair.close, prefix: ",", suffix: "" };
    }
    const prefix = needsCommaBefore(formula, pair.open + 1, clamped) ? "," : "";
    return { start: clamped, end: clamped, prefix, suffix: "" };
  }

  const before = formula.slice(0, clamped);
  const quoted = quotedMask(formula);
  if (!quoted[Math.max(0, clamped - 1)] || clamped === 0) {
    const name = TRAILING_NAME_RE.exec(before);
    if (name && !A1_REF_RE.test(name[0])) {
      const charBefore = before[name.index - 1];
      if (!charBefore || /[^A-Za-z0-9_.$]/.test(charBefore)) {
        return { start: clamped, end: clamped, prefix: "(", suffix: ")" };
      }
    }
  }

  return { start: clamped, end: clamped, prefix: "", suffix: "" };
}

function appendInsertSite(
  formula: string,
  caret: number,
  afterSpan?: FormulaRefSpan | null,
): InsertSite {
  const at = Math.max(
    0,
    Math.min(
      afterSpan && afterSpan.end >= afterSpan.start ? afterSpan.end : caret,
      formula.length,
    ),
  );
  const probe = at > 0 ? at - 1 : at;
  const pair = findParenPairAt(formula, probe);
  if (pair) {
    const insertAt = Math.min(Math.max(at, pair.open + 1), pair.close);
    const prefix = needsCommaBefore(formula, pair.open + 1, insertAt)
      ? ","
      : "";
    return { start: insertAt, end: insertAt, prefix, suffix: "" };
  }
  const before = formula.slice(0, at).trimEnd();
  const prefix = before.length > 1 && !ARG_BREAK_RE.test(before) ? "," : "";
  return { start: at, end: at, prefix, suffix: "" };
}

const VARIADIC_RANGE_FUNCS = new Set([
  "SUM",
  "AVERAGE",
  "AVG",
  "MIN",
  "MAX",
  "PRODUCT",
  "COUNT",
  "COUNTA",
  "AND",
  "OR",
]);

/** True when another picked range should be appended (SUM) rather than replacing (ROUND). */
export function formulaAcceptsAnotherRange(
  formula: string,
  span?: FormulaRefSpan | null,
): boolean {
  if (!span) return false;
  const pair = findParenPairAt(formula, span.start);
  if (!pair) return false;
  const before = formula.slice(0, pair.open);
  const name = TRAILING_NAME_RE.exec(before);
  if (!name || A1_REF_RE.test(name[0])) return false;
  return VARIADIC_RANGE_FUNCS.has(name[0].toUpperCase());
}

/** Insert or replace an A1 range at the caret, spreadsheet-style. */
export function insertFormulaRange(
  formula: string,
  caret: number,
  rangeLabel: string,
  activeSpan?: FormulaRefSpan | null,
  mode: "replace" | "append" = "replace",
): { value: string; caret: number; span: FormulaRefSpan } {
  if (mode === "append") {
    const site = appendInsertSite(formula, caret, activeSpan);
    const inserted = site.prefix + rangeLabel + site.suffix;
    const raw =
      formula.slice(0, site.start) + inserted + formula.slice(site.end);
    const value = closeOpenParens(raw);
    const labelStart = site.start + site.prefix.length;
    const nextSpan = { start: labelStart, end: labelStart + rangeLabel.length };
    return { value, caret: nextSpan.end, span: nextSpan };
  }

  const span =
    activeSpan && activeSpan.end >= activeSpan.start
      ? activeSpan
      : findFormulaRefAt(formula, caret);

  let start: number;
  let end: number;
  let inserted: string;

  if (span) {
    start = span.start;
    end = span.end;
    inserted = rangeLabel;
  } else {
    const site = findInsertSite(formula, caret);
    start = site.start;
    end = site.end;
    inserted = site.prefix + rangeLabel + site.suffix;
  }

  const raw = formula.slice(0, start) + inserted + formula.slice(end);
  const value = closeOpenParens(raw);
  const labelStart = start + (span ? 0 : inserted.indexOf(rangeLabel));
  const nextSpan = { start: labelStart, end: labelStart + rangeLabel.length };
  return { value, caret: nextSpan.end, span: nextSpan };
}

export interface FormulaInputHint {
  /** Function names that start with the word being typed (=SU → SUM, SUMIF…). */
  suggestions: string[];
  /** Where the word being typed starts and ends, for replacing it. */
  word: { start: number; end: number } | null;
  /** The innermost function the caret is inside, and which argument (0-based). */
  current: { name: string; argument: number } | null;
}

/**
 * What to show while someone types a formula: matching function names for a
 * half-typed word, and the function (and argument) the caret sits in.
 */
export function formulaInputHint(formula: string, caret: number, functionNames: readonly string[]): FormulaInputHint {
  const empty: FormulaInputHint = { suggestions: [], word: null, current: null };
  if (!formula.trim().startsWith("=")) return empty;
  const before = formula.slice(0, caret);
  let inString = false;
  const stack: { name: string; argument: number }[] = [];
  for (let index = before.indexOf("=") + 1; index < before.length; index += 1) {
    const char = before[index];
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") {
      const name = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(before.slice(0, index))?.[1]?.toUpperCase() ?? "";
      stack.push({ name, argument: 0 });
    } else if (char === ")") {
      stack.pop();
    } else if (char === "," && stack.length) {
      stack[stack.length - 1].argument += 1;
    }
  }
  if (inString) return { ...empty, current: [...stack].reverse().find((entry) => entry.name) ?? null };
  const current = [...stack].reverse().find((entry) => entry.name) ?? null;
  const match = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
  let suggestions: string[] = [];
  let word: FormulaInputHint["word"] = null;
  if (match && !/[A-Za-z0-9.!$']/.test(formula[caret] ?? "") && !/[!$']$/.test(before.slice(0, -match[1].length))) {
    const typed = match[1].toUpperCase();
    // A cell reference such as A1 or AB12 is not a function name.
    if (!/^[A-Z]{1,3}\d+$/.test(typed)) {
      suggestions = functionNames.filter((name) => name.startsWith(typed) && name !== typed).slice(0, 6);
      if (suggestions.length) word = { start: caret - match[1].length, end: caret };
    }
  }
  return { suggestions, word, current };
}

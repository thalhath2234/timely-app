export interface FormulaRefSpan {
  start: number;
  end: number;
}

const REF_RE = /\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?/g;
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

function findParenPairAt(formula: string, caret: number): { open: number; close: number } | null {
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
      containing = pair;
    }
  }

  if (containing) return containing;

  const unclosed = stack[stack.length - 1];
  if (unclosed != null && caret > unclosed) {
    return { open: unclosed, close: formula.length };
  }

  if (lastClosed && caret >= lastClosed.close && lastClosed.close === formula.length - 1) {
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
    const prefix = needsCommaBefore(formula, pair.open + 1, insertAt) ? "," : "";
    return { start: insertAt, end: insertAt, prefix, suffix: "" };
  }
  const before = formula.slice(0, at).trimEnd();
  const prefix = before.length > 1 && !ARG_BREAK_RE.test(before) ? "," : "";
  return { start: at, end: at, prefix, suffix: "" };
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
    const raw = formula.slice(0, site.start) + inserted + formula.slice(site.end);
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

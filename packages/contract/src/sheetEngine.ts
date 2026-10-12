/**
 * The formula engine as one function the API runs in its JavaScript VM, so
 * agents read the same values the apps show. `make gen-sheet-engine` bundles
 * this file into apps/api/internal/features/sheet/engine/sheet-engine.js.
 */
import type { SheetColumn, SheetTab } from "./sheet";
import { createSheetEvaluator, createWorkbookEvaluators } from "./sheetFormula";
import { serialToIso, type CellResult } from "./sheetValues";

/** A worked-out cell: a number, text, boolean, null when empty, or an error. */
export type EngineValue = number | string | boolean | null | { error: string };

interface EngineRequest {
  tabs: SheetTab[];
  /** Work out this formula on tabId's tab instead of the whole workbook. */
  formula?: string;
  tabId?: string;
}

function plain(result: CellResult, column: Pick<SheetColumn, "type"> | undefined): EngineValue {
  switch (result.type) {
    case "empty":
      return null;
    case "error":
      return { error: result.message };
    case "number":
      return column?.type === "date" ? serialToIso(result.value) : result.value;
    default:
      return result.value;
  }
}

function evaluateFormula(tabs: SheetTab[], tabId: string | undefined, formula: string): EngineValue {
  const index = Math.max(
    tabs.findIndex((tab) => tab.id === tabId),
    0,
  );
  const tab = tabs[index];
  if (!tab) return { error: "#REF!" };
  // The formula sits in a cell past the last row and column, so it reads the
  // tab like any cell on it without landing in the ranges it reads.
  const column: SheetColumn = { id: "__query", name: "Query", type: "formula", width: 0 } as SheetColumn;
  const text = formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`;
  const scratch: SheetTab = {
    ...tab,
    columns: [...tab.columns, column],
    rows: [...tab.rows, { id: "__query", cells: { __query: text } }],
  };
  const workbook = tabs.map((each, i) => (i === index ? scratch : each));
  const evaluator = createSheetEvaluator(scratch.columns, scratch.rows, { tabs: workbook, currentTabId: scratch.id });
  return plain(evaluator.valueAt(scratch.columns.length - 1, scratch.rows.length - 1), undefined);
}

/** Takes and returns JSON so the API's VM only passes strings. */
export function evaluate(json: string): string {
  const request = JSON.parse(json) as EngineRequest;
  const tabs = request.tabs ?? [];
  if (request.formula !== undefined) {
    return JSON.stringify({ value: evaluateFormula(tabs, request.tabId, request.formula) });
  }
  const evaluatorFor = createWorkbookEvaluators({ tabs });
  const values = tabs.map((tab) => {
    const evaluator = evaluatorFor(tab.id);
    return tab.rows.map((_, row) =>
      tab.columns.map((column, col) => (evaluator ? plain(evaluator.valueAt(col, row), column) : null)),
    );
  });
  return JSON.stringify({ tabs: values });
}

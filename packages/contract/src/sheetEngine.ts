/**
 * The formula engine as one function the API runs in its JavaScript VM, so
 * agents read the same values the apps show. `make gen-sheet-engine` bundles
 * this file into apps/api/internal/features/sheet/engine/sheet-engine.js.
 */
import type { Sheet, SheetColumn, SheetTab } from "./sheet";
import { cellsBrief } from "./sheetCells";
import { createSheetEvaluator, createWorkbookEvaluators } from "./sheetFormula";
import { adjustTabForStructure, applyStructureChange, type StructureChange } from "./sheetOps";
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

interface RestructureRequest {
  tabs: SheetTab[];
  tabId: string;
  /** Applied in order, each counted on the grid the one before left. */
  changes: StructureChange[];
}

const noNewCells = () => {
  throw new Error("restructure only deletes rows and columns");
};

/**
 * Deletes rows or columns of one tab the way the apps do: formulas on every
 * tab keep pointing at the same cells, and references to deleted cells become
 * #REF!. Merges, frozen panes and colour rules follow too.
 */
export function restructure(json: string): string {
  const request = JSON.parse(json) as RestructureRequest;
  let tabs = request.tabs ?? [];
  for (const change of request.changes ?? []) {
    if (change.kind !== "delete") noNewCells();
    const index = tabs.findIndex((tab) => tab.id === request.tabId);
    if (index < 0) throw new Error("tab not found");
    const changed = tabs[index].name;
    tabs = tabs.map((tab, i) =>
      i === index
        ? applyStructureChange(tab, change, { row: noNewCells, column: noNewCells })
        : adjustTabForStructure(tab, change, changed),
    );
  }
  return JSON.stringify({ tabs });
}

interface BriefRequest {
  sheets: Pick<Sheet, "id" | "title" | "tabs">[];
}

/**
 * Each sheet's tabs with the column names a described card's `@Cells` call
 * can use and which hold numbers (sheetCells.ts), for the model's instructions.
 */
export function cellsBriefs(json: string): string {
  const request = JSON.parse(json) as BriefRequest;
  const sheets = (request.sheets ?? []).map((sheet) => cellsBrief({ ...sheet, columns: [], rows: [] } as unknown as Sheet));
  return JSON.stringify({ sheets });
}

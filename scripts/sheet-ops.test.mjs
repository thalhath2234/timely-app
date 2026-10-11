import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  adjustTabForStructure,
  applyStructureChange,
  isSummaryRow,
  parseClipboardTable,
  pasteTable,
  renameSheetInTabs,
  seriesValues,
  sortGridRows,
  tableToClipboardText,
} from "../packages/contract/src/sheetOps.ts";
import { createSheetEvaluator } from "../packages/contract/src/sheetFormula.ts";

let seq = 0;
const make = {
  row: (columns) => ({ id: `new${seq++}`, cells: Object.fromEntries(columns.map((c) => [c.id, ""])) }),
  column: (index) => ({ id: `nc${seq++}`, name: `N${index}`, width: 100, type: "text" }),
};
const cols = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: String.fromCharCode(65 + i), width: 100, type: "text" }));
const grid = (data, name = "Main") => {
  const columns = cols(Math.max(...data.map((r) => r.length)));
  return {
    name,
    columns,
    rows: data.map((cells, r) => ({ id: `r${r}`, cells: Object.fromEntries(cells.map((v, c) => [`c${c}`, v])) })),
    merges: [],
  };
};
const cell = (g, row, col) => g.rows[row].cells[g.columns[col].id];

describe("structure changes", () => {
  test("inserting rows keeps formulas, totals and merges pointing at the same cells", () => {
    const g = { ...grid([["1", "=A1*2"], ["2", "=A2*2"], ["=SUM(A1:A2)", ""]]), merges: [{ startCol: 0, startRow: 0, colSpan: 2, rowSpan: 2 }], frozenRows: 1 };
    const next = applyStructureChange(g, { kind: "insert", axis: "row", at: 2, count: 1 }, make);
    assert.equal(next.rows.length, 4);
    assert.equal(cell(next, 1, 1), "=A2*2");
    assert.equal(cell(next, 3, 0), "=SUM(A1:A3)", "a total right under its range grows");
    assert.deepEqual(next.merges, [{ startCol: 0, startRow: 0, colSpan: 2, rowSpan: 2 }]);
    const top = applyStructureChange(g, { kind: "insert", axis: "row", at: 0, count: 2 }, make);
    assert.equal(cell(top, 4, 0), "=SUM(A3:A4)");
    assert.equal(top.frozenRows, 3);
  });

  test("deleting columns turns lost references into #REF! and drops their rules", () => {
    const g = {
      ...grid([["1", "2", "=A1+B1", "=C1"]]),
      conditionalFormats: [{ id: "x", columnId: "c1", operator: "gt", value: "1", fillColor: "#ff0000" }],
    };
    const next = applyStructureChange(g, { kind: "delete", axis: "col", at: 1, count: 1 }, make);
    assert.equal(next.columns.length, 3);
    assert.equal(cell(next, 0, 1), "=A1+#REF!");
    assert.equal(cell(next, 0, 2), "=B1");
    assert.deepEqual(next.conditionalFormats, []);
  });

  test("other tabs follow inserted rows", () => {
    const summary = grid([["=SUM(Main!A2:A)", "=Main!B3", "=B3"]], "Summary");
    const next = adjustTabForStructure(summary, { kind: "insert", axis: "row", at: 0, count: 1 }, "Main");
    assert.deepEqual(next.rows[0].cells, { c0: "=SUM(Main!A3:A)", c1: "=Main!B4", c2: "=B3" });
    const untouched = adjustTabForStructure(summary, { kind: "insert", axis: "row", at: 0, count: 1 }, "Other");
    assert.equal(untouched, summary);
  });

  test("renaming a tab rewrites references everywhere", () => {
    const tabs = [grid([["=SUM(Jan!A1:A3)", "='Jan'!B1"]], "Summary"), grid([["1"]], "Jan")];
    const next = renameSheetInTabs(tabs, "Jan", "January 2026");
    assert.deepEqual(next[0].rows[0].cells, { c0: "=SUM('January 2026'!A1:A3)", c1: "='January 2026'!B1" });
    assert.equal(next[1], tabs[1]);
  });
});

describe("clipboard", () => {
  test("parses quoted cells with tabs, newlines and quotes", () => {
    assert.deepEqual(parseClipboardTable('a\t"b\tc"\n"line1\nline2"\t"say ""hi"""\n'), [
      ["a", "b\tc"],
      ["line1\nline2", 'say "hi"'],
    ]);
    assert.deepEqual(parseClipboardTable('5" screen\tx'), [['5" screen', "x"]]);
    assert.deepEqual(parseClipboardTable("a\r\nb\r\n"), [["a"], ["b"]]);
    const table = [["a\tb", 'q"'], ["x", "y"]];
    assert.deepEqual(parseClipboardTable(tableToClipboardText(table)), table);
  });

  test("pasting grows the grid and shifts copied formulas", () => {
    const g = grid([["1", "2"], ["3", "4"]]);
    const result = pasteTable(g, [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]], { col: 1, row: 1 }, make);
    assert.equal(result.grid.columns.length, 4);
    assert.equal(result.grid.rows.length, 4);
    assert.equal(cell(result.grid, 3, 3), "i");
    const shifted = pasteTable(g, [["=A1*2"]], { col: 1, row: 1 }, make, { col: 0, row: 0 });
    assert.equal(cell(shifted.grid, 1, 1), "=B2*2");
    const typed = { ...g, columns: g.columns.map((c, i) => (i === 0 ? { ...c, type: "number" } : c)) };
    assert.equal(cell(pasteTable(typed, [["Rs 1,250"]], { col: 0, row: 0 }, make).grid, 0, 0), "1250");
  });
});

describe("sorting", () => {
  test("blanks last, totals stay put, row formulas follow their row", () => {
    const g = grid([
      ["Item", "Total"],
      ["Rice", "=3*100"],
      ["", ""],
      ["apple", "=1*100"],
      ["Bread", "=2*100"],
      ["Sum", "=SUM(B2:B5)"],
    ]);
    g.rows[1].cells.c1 = "=C2*100";
    g.rows[1].cells.c2 = "3";
    g.rows[3].cells.c1 = "=C4*100";
    g.rows[3].cells.c2 = "1";
    g.rows[4].cells.c1 = "=C5*100";
    g.rows[4].cells.c2 = "2";
    g.columns.push({ id: "c2", name: "C", width: 100, type: "number" });
    const ev = createSheetEvaluator(g.columns, g.rows);
    const sorted = sortGridRows(g.rows, g.columns, 0, "asc", ev.valueAt, { frozenRows: 1 });
    assert.deepEqual(sorted.map((r) => r.cells.c0), ["Item", "apple", "Bread", "Rice", "", "Sum"]);
    assert.equal(sorted[1].cells.c1, "=C2*100", "apple's formula now reads its own row");
    const after = createSheetEvaluator(g.columns, sorted);
    assert.deepEqual(after.valueAt(1, 1), { type: "number", value: 100 });
    assert.deepEqual(after.valueAt(1, 5), { type: "number", value: 600 });
    const desc = sortGridRows(g.rows, g.columns, 1, "desc", ev.valueAt, { frozenRows: 1 });
    assert.deepEqual(desc.map((r) => r.cells.c0), ["Item", "Rice", "Bread", "apple", "", "Sum"]);
  });

  test("summary rows are recognised", () => {
    const columns = cols(2);
    assert.equal(isSummaryRow({ id: "x", cells: { c1: "=SUM(B1:B4)" } }, 5, columns), true);
    assert.equal(isSummaryRow({ id: "x", cells: { c1: "=A2*2" } }, 1, columns), false);
    assert.equal(isSummaryRow({ id: "x", cells: { c1: "=SUM(Jan!B1:B4)" } }, 1, columns), false);
  });

  test("dates and numbers sort by value, a range sorts only its rows", () => {
    const g = grid([["2026-03-01"], ["2026-01-15"], ["10"], ["9"]]);
    const ev = createSheetEvaluator(g.columns, g.rows);
    const sorted = sortGridRows(g.rows, g.columns, 0, "asc", ev.valueAt, { rowRange: { start: 2, end: 3 } });
    assert.deepEqual(sorted.map((r) => r.cells.c0), ["2026-03-01", "2026-01-15", "9", "10"]);
  });
});

describe("fill series", () => {
  test("numbers, dates, months, weekdays and numbered text", () => {
    assert.deepEqual(seriesValues(["1"], 3), ["2", "3", "4"]);
    assert.deepEqual(seriesValues(["5", "10"], 2), ["15", "20"]);
    assert.deepEqual(seriesValues(["0.5", "1"], 2), ["1.5", "2"]);
    assert.deepEqual(seriesValues(["2026-01-30"], 3), ["2026-01-31", "2026-02-01", "2026-02-02"]);
    assert.deepEqual(seriesValues(["2026-01-01", "2026-01-08"], 1), ["2026-01-15"]);
    assert.deepEqual(seriesValues(["November"], 3), ["December", "January", "February"]);
    assert.deepEqual(seriesValues(["jan"], 2), ["feb", "mar"]);
    assert.deepEqual(seriesValues(["Mon", "Wed"], 2), ["Fri", "Sun"]);
    assert.deepEqual(seriesValues(["Item 1"], 2), ["Item 2", "Item 3"]);
    assert.deepEqual(seriesValues(["INV-009"], 2), ["INV-010", "INV-011"]);
    assert.deepEqual(seriesValues(["Rice", "Milk"], 3), ["Rice", "Milk", "Rice"]);
    assert.deepEqual(seriesValues(["3", "4"], 2, true), ["2", "1"], "filling up counts down");
    assert.deepEqual(seriesValues(["a", "b"], 2, true), ["b", "a"]);
  });
});

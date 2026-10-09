import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  isFormulaValue,
  normalizeTypedCell,
} from "../packages/contract/src/sheetCell.ts";
import {
  applyColumnTypes,
  columnSamples,
  csvToGrid,
  parseCsvLine,
  sheetToCsv,
} from "../packages/contract/src/sheetCsv.ts";

function ids() {
  let col = 0;
  let row = 0;
  return {
    newColumnId: () => `c${(col += 1)}`,
    newRowId: () => `r${(row += 1)}`,
  };
}

describe("normalizeTypedCell", () => {
  test("formulas, blanks, text and untyped cells pass through", () => {
    assert.equal(isFormulaValue("  =A1"), true);
    assert.equal(isFormulaValue("A1"), false);
    assert.equal(normalizeTypedCell("number", "=A1+1"), "=A1+1");
    assert.equal(normalizeTypedCell("number", "   "), "   ");
    assert.equal(normalizeTypedCell("text", " hi "), " hi ");
    assert.equal(normalizeTypedCell(undefined, "x"), "x");
  });

  test("numeric types strip separators and convert percents", () => {
    for (const type of ["number", "currency", "percent", "formula"]) {
      assert.equal(normalizeTypedCell(type, " 1,234.50 "), "1234.5");
    }
    assert.equal(normalizeTypedCell("percent", "50%"), "0.5");
    assert.equal(normalizeTypedCell("number", "abc"), "");
  });

  test("dates keep ISO and reformat parseable text", () => {
    assert.equal(normalizeTypedCell("date", "2026-10-05"), "2026-10-05");
    assert.equal(normalizeTypedCell("date", "10/05/2026"), "2026-10-05");
    assert.equal(normalizeTypedCell("date", "not a date"), "");
  });

  test("booleans and select", () => {
    for (const yes of ["true", "1", "Yes", "y"])
      assert.equal(normalizeTypedCell("boolean", yes), "TRUE");
    for (const no of ["FALSE", "0", "no", "N"])
      assert.equal(normalizeTypedCell("boolean", no), "FALSE");
    assert.equal(normalizeTypedCell("boolean", "maybe"), "");
    assert.equal(normalizeTypedCell("select", "  Open "), "Open");
  });
});

describe("sheet CSV", () => {
  test("parseCsvLine handles quotes, escaped quotes and empty cells", () => {
    assert.deepEqual(parseCsvLine('a,"b,c","d ""q"""'), ["a", "b,c", 'd "q"']);
    assert.deepEqual(parseCsvLine("a,,"), ["a", "", ""]);
  });

  test("csvToGrid reads the header and pads short rows", () => {
    const { columns, rows } = csvToGrid("\uFEFFName,Qty\r\nApple,3\nPear\n", ids());
    assert.deepEqual(
      columns.map((c) => [c.id, c.name, c.type, c.width]),
      [
        ["c1", "Name", "text", 160],
        ["c2", "Qty", "text", 160],
      ],
    );
    assert.deepEqual(rows, [
      { id: "r1", cells: { c1: "Apple", c2: "3" } },
      { id: "r2", cells: { c1: "Pear", c2: "" } },
    ]);
  });

  test("csvToGrid names blank headers by letter and handles empty input", () => {
    const { columns } = csvToGrid("Name,,\n1,2,3", ids());
    assert.deepEqual(
      columns.map((c) => c.name),
      ["Name", "B", "C"],
    );
    const empty = csvToGrid("", ids());
    assert.equal(empty.columns.length, 1);
    assert.equal(empty.columns[0].name, "A");
    assert.deepEqual(empty.rows, [{ id: "r1", cells: { c1: "" } }]);
    assert.equal(csvToGrid("A,B", ids()).rows.length, 1);
  });

  test("sheetToCsv escapes values and keeps formulas raw", () => {
    const columns = [
      { id: "a", name: "Name, full", width: 100, type: "text" },
      { id: "b", name: "Total", width: 100, type: "number" },
    ];
    const rows = [{ id: "r1", cells: { a: 'say "hi"', b: "=SUM(A1)" } }];
    const display = (col) => (col === 0 ? 'say "hi"' : "42");
    assert.equal(
      sheetToCsv(columns, rows, display),
      '"Name, full",Total\n"say ""hi""",=SUM(A1)',
    );
  });

  test("sheetToCsv output round-trips through csvToGrid", () => {
    const columns = [{ id: "a", name: "A", width: 100, type: "text" }];
    const rows = [{ id: "r1", cells: { a: 'x,"y"' } }];
    const csv = sheetToCsv(columns, rows, () => 'x,"y"');
    const parsed = csvToGrid(csv, ids());
    assert.equal(Object.values(parsed.rows[0].cells)[0], 'x,"y"');
  });
});

describe("applyColumnTypes", () => {
  test("types columns the suggestions name and normalizes their values", () => {
    const grid = csvToGrid("Item,Cost,Paid,Status\nRent,900.50,yes,Open\nFood,12,no,Done\n", ids());
    assert.deepEqual(columnSamples(grid)[1], { name: "Cost", values: ["900.50", "12"] });
    const typed = applyColumnTypes(grid, [null, { type: "currency" }, { type: "boolean" }, { type: "select", options: ["Open", "Done"] }]);
    assert.deepEqual(typed.columns.map((c) => c.type), ["text", "currency", "boolean", "select"]);
    assert.deepEqual(typed.columns[3].options, ["Open", "Done"]);
    assert.deepEqual(typed.rows[0].cells, { c1: "Rent", c2: "900.5", c3: "TRUE", c4: "Open" });
  });
  test("a column whose values do not all fit stays text", () => {
    const grid = csvToGrid("Amount\n12\nabout 5\n", ids());
    const typed = applyColumnTypes(grid, [{ type: "number" }]);
    assert.equal(typed.columns[0].type, "text");
    assert.equal(typed.rows[1].cells.c1, "about 5");
  });
});

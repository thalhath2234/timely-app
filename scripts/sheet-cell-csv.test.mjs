import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  isFormulaValue,
  normalizeTypedCell,
} from "../packages/contract/src/sheetCell.ts";
import * as cell from "../packages/contract/src/sheetCell.ts";
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
    assert.equal(normalizeTypedCell("number", "abc"), "abc");
  });

  test("dates keep ISO and reformat parseable text", () => {
    assert.equal(normalizeTypedCell("date", "2026-10-05"), "2026-10-05");
    assert.equal(normalizeTypedCell("date", "10/05/2026"), "2026-10-05");
    assert.equal(normalizeTypedCell("date", "not a date"), "not a date");
  });

  test("booleans and select", () => {
    for (const yes of ["true", "1", "Yes", "y"])
      assert.equal(normalizeTypedCell("boolean", yes), "TRUE");
    for (const no of ["FALSE", "0", "no", "N"])
      assert.equal(normalizeTypedCell("boolean", no), "FALSE");
    assert.equal(normalizeTypedCell("boolean", "maybe"), "maybe");
    assert.equal(normalizeTypedCell("select", "  Open "), "Open");
  });
});

describe("typed input people actually write", () => {
  test("amounts with currency, codes, decimal commas and brackets", () => {
    for (const [input, expected] of [
      ["$12.50", "12.5"],
      ["Rs 1,250", "1250"],
      ["Rs. 99", "99"],
      ["LKR 500", "500"],
      ["500 LKR", "500"],
      ["€9,99", "9.99"],
      ["1.234,56", "1234.56"],
      ["(45.00)", "-45"],
      ["-$3", "-3"],
      ["₹ 2,00,000", "200000"],
      ["½", "0.5"],
    ]) {
      assert.equal(normalizeTypedCell("currency", input), expected, input);
    }
    assert.equal(normalizeTypedCell("number", "1.5 kg"), "1.5 kg");
    assert.equal(cell.cellFitsType("number", "1.5 kg"), false);
    assert.equal(cell.cellFitsType("number", "1.5"), true);
  });

  test("dates in the shapes people type", () => {
    const today = new Date(2026, 9, 11);
    const { parseDateInput } = cell;
    assert.equal(parseDateInput("11/10/2026", { dayFirst: true }), "2026-10-11");
    assert.equal(parseDateInput("11/10/2026", { dayFirst: false }), "2026-11-10");
    assert.equal(parseDateInput("13/02/2026", { dayFirst: false }), "2026-02-13");
    assert.equal(parseDateInput("11 Oct 2026"), "2026-10-11");
    assert.equal(parseDateInput("11-Oct-26"), "2026-10-11");
    assert.equal(parseDateInput("Oct 11, 2026"), "2026-10-11");
    assert.equal(parseDateInput("3rd March", { today }), "2026-03-03");
    assert.equal(parseDateInput("2026/10/11"), "2026-10-11");
    assert.equal(parseDateInput("today", { today }), "2026-10-11");
    assert.equal(parseDateInput("yesterday", { today }), "2026-10-10");
    assert.equal(parseDateInput("31/02/2026", { dayFirst: true }), null);
    assert.equal(parseDateInput("someday"), null);
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

  test("sheetToCsv escapes values and writes formula results", () => {
    const columns = [
      { id: "a", name: "Name, full", width: 100, type: "text" },
      { id: "b", name: "Total", width: 100, type: "number" },
    ];
    const rows = [{ id: "r1", cells: { a: 'say "hi"', b: "=SUM(A1)" } }];
    const display = (col) => (col === 0 ? 'say "hi"' : "42");
    assert.equal(
      sheetToCsv(columns, rows, display),
      '"Name, full",Total\n"say ""hi""",42',
    );
  });

  test("sheetToCsv leaves out empty rows at the bottom and empty letter columns on the right", () => {
    const columns = ["A", "B", "Notes", "D", "E"].map((name, i) => ({
      id: `c${i}`,
      name,
      width: 100,
      type: "text",
    }));
    const values = [
      ["Item", "Total", "", "", ""],
      ["Rent", "1200", "", "", ""],
      ["", "", "", "", ""],
      ["Food", '"yes"', "", "", ""],
      ["", "", "", "", ""],
      ["  ", "", "", "", ""],
    ];
    const rows = values.map((_, i) => ({ id: `r${i}`, cells: {} }));
    const csv = sheetToCsv(columns, rows, (col, row) => values[row][col]);
    // The named "Notes" column stays; D and E go. The blank middle row stays.
    assert.equal(
      csv,
      'A,B,Notes\nItem,Total,\nRent,1200,\n,,\nFood,"""yes""",',
    );
  });

  test("sheetToCsv with only empty cells writes the header", () => {
    const columns = [{ id: "a", name: "A", width: 100, type: "text" }, { id: "b", name: "B", width: 100, type: "text" }];
    const rows = [{ id: "r1", cells: {} }, { id: "r2", cells: {} }];
    assert.equal(sheetToCsv(columns, rows, () => ""), "A");
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
  test("decimal commas, codes and other date formats stay text", () => {
    const grid = csvToGrid('Betrag,Zip,When,Status\n"12,50",02134,2026-10-01,Open\n"3,99",10001,03/04/2026,Gone\n', ids());
    const typed = applyColumnTypes(grid, [{ type: "currency" }, { type: "number" }, { type: "date" }, { type: "select", options: ["Open"] }]);
    assert.deepEqual(typed.columns.map((c) => c.type), ["text", "text", "text", "text"]);
    assert.equal(typed.rows[0].cells.c1, "12,50");
    assert.equal(typed.rows[0].cells.c2, "02134");
  });
  test("thousands groups still read as amounts", () => {
    const grid = csvToGrid('Cost\n"1,234.50"\n-12\n0.99\n', ids());
    const typed = applyColumnTypes(grid, [{ type: "currency" }]);
    assert.equal(typed.columns[0].type, "currency");
  });
});

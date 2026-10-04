import assert from "node:assert/strict";
import test from "node:test";
import { growGridTo, isPastGrid } from "../apps/mobile/lib/sheetGrow.ts";

const makeColumn = (index) => ({ id: `new_c${index}`, name: `N${index}`, type: "text", width: 140 });
let rowSeq = 0;
const makeRow = (columns) => ({
  id: `new_r${rowSeq++}`,
  cells: Object.fromEntries(columns.map((column) => [column.id, ""])),
});
const grid = () => ({
  columns: [
    { id: "c0", name: "A", type: "text", width: 140 },
    { id: "c1", name: "B", type: "number", width: 140 },
  ],
  rows: [
    { id: "r0", cells: { c0: "Tilapia", c1: "900" } },
    { id: "r1", cells: { c0: "Rice", c1: "3600" } },
  ],
});

test("isPastGrid flags addresses beyond the last row or column", () => {
  const g = grid();
  assert.equal(isPastGrid(g, { col: 1, row: 1 }), false);
  assert.equal(isPastGrid(g, { col: 2, row: 0 }), true);
  assert.equal(isPastGrid(g, { col: 0, row: 2 }), true);
});

test("growGridTo returns the same arrays when the cell exists", () => {
  const g = grid();
  const grown = growGridTo(g, { col: 1, row: 1 }, makeColumn, makeRow);
  assert.equal(grown.columns, g.columns);
  assert.equal(grown.rows, g.rows);
});

test("growGridTo adds blank rows up to the target row", () => {
  const g = grid();
  const grown = growGridTo(g, { col: 0, row: 4 }, makeColumn, makeRow);
  assert.equal(grown.columns, g.columns);
  assert.equal(grown.rows.length, 5);
  assert.deepEqual(grown.rows.slice(0, 2), g.rows);
  for (const row of grown.rows.slice(2)) assert.deepEqual(row.cells, { c0: "", c1: "" });
});

test("growGridTo adds columns and blanks them on existing rows", () => {
  const g = grid();
  const grown = growGridTo(g, { col: 3, row: 2 }, makeColumn, makeRow);
  assert.deepEqual(grown.columns.map((column) => column.id), ["c0", "c1", "new_c2", "new_c3"]);
  assert.deepEqual(grown.rows[0].cells, { c0: "Tilapia", c1: "900", new_c2: "", new_c3: "" });
  assert.deepEqual(grown.rows[2].cells, { c0: "", c1: "", new_c2: "", new_c3: "" });
  assert.deepEqual(g.rows[0].cells, { c0: "Tilapia", c1: "900" }, "input rows are not mutated");
});

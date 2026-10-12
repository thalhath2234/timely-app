import assert from "node:assert/strict";
import test, { describe } from "node:test";
import * as refs from "../packages/contract/src/sheetRefs.ts";

describe("sheetRefs", () => {
  const { shiftFormula, adjustFormulaForStructure: adjust, renameSheetInFormula, scanFormulaRefs } = refs;

  test("fill keeps $ parts and shifts tab references", () => {
    assert.equal(shiftFormula("=E1*$G$1+G$1+$G1", 1, 1), "=F2*$G$1+H$1+$G2");
    assert.equal(shiftFormula("=SUM(January!A1:A3)", 0, 1), "=SUM(January!A2:A4)");
    assert.equal(shiftFormula("='Q1 2026'!B2", 0, 1), "='Q1 2026'!B3");
  });

  test("fill leaves function names, strings and bare tab names alone", () => {
    assert.equal(shiftFormula('=LOG10(A1)&"A1"', 0, 1), '=LOG10(A2)&"A1"');
    assert.equal(shiftFormula("=Jan2026!A1+ATAN2(1,B1)", 0, 1), "=Jan2026!A2+ATAN2(1,B2)");
  });

  test("scanner finds ranges, whole columns and quoted tabs", () => {
    const found = scanFormulaRefs("=SUM(D:D)+'It''s'!A1:B2+C3");
    assert.deepEqual(found.map((ref) => [ref.sheet, refs.formatRef(ref)]), [
      [null, "D:D"],
      ["It's", "'It''s'!A1:B2"],
      [null, "C3"],
    ]);
  });

  const ctx = (row, sheet = "Main") => ({ changedSheet: "Main", formulaSheet: sheet, formulaRow: row, formulaCol: 0 });
  const insertRows = (at, count = 1) => ({ kind: "insert", axis: "row", at, count });
  const deleteRows = (at, count = 1) => ({ kind: "delete", axis: "row", at, count });

  test("inserting rows above moves references down", () => {
    assert.equal(adjust("=A5+SUM(B2:B4)", insertRows(0), ctx(9)), "=A6+SUM(B3:B5)");
  });

  test("inserting inside a range grows it", () => {
    assert.equal(adjust("=SUM(B2:B4)", insertRows(2, 2), ctx(9)), "=SUM(B2:B6)");
  });

  test("a total grows when a row is inserted right above it", () => {
    // Total on row 4 (index 3) sums B1:B3; a new row goes in at index 3.
    assert.equal(adjust("=SUM(B1:B3)", insertRows(3), ctx(3)), "=SUM(B1:B4)");
    // A formula above the insertion point does not grow.
    assert.equal(adjust("=SUM(B1:B3)", insertRows(3), ctx(0)), "=SUM(B1:B3)");
  });

  test("absolute references still follow inserted rows", () => {
    assert.equal(adjust("=$B$5", insertRows(1), ctx(0)), "=$B$6");
  });

  test("open ranges and whole columns are left alone", () => {
    assert.equal(adjust("=SUM(B:B)+SUM(B2:B)", insertRows(5), ctx(0)), "=SUM(B:B)+SUM(B2:B)");
    assert.equal(adjust("=SUM(B2:B)", insertRows(0), ctx(0)), "=SUM(B3:B)");
  });

  test("deleting rows shrinks ranges and breaks lost references", () => {
    assert.equal(adjust("=SUM(B2:B6)", deleteRows(2, 2), ctx(9)), "=SUM(B2:B4)");
    assert.equal(adjust("=B3*2", deleteRows(2), ctx(9)), "=#REF!*2");
    assert.equal(adjust("=SUM(B3:B4)", deleteRows(2, 2), ctx(9)), "=SUM(#REF!)");
    assert.equal(adjust("=B9", deleteRows(2, 2), ctx(9)), "=B7");
  });

  test("columns move the same way", () => {
    assert.equal(adjust("=C1+SUM(A1:D1)", { kind: "insert", axis: "col", at: 1, count: 1 }, ctx(0)), "=D1+SUM(A1:E1)");
    assert.equal(adjust("=C1+D1", { kind: "delete", axis: "col", at: 2, count: 1 }, ctx(0)), "=#REF!+C1");
  });

  test("only references to the changed tab move", () => {
    assert.equal(adjust("=A5+Main!A5", insertRows(0), ctx(0, "Summary")), "=A5+Main!A6");
    assert.equal(adjust("=Other!A5", insertRows(0), ctx(0)), "=Other!A5");
    // Totals in another tab never grow on their own.
    assert.equal(adjust("=SUM(Main!B1:B3)", insertRows(3), ctx(3, "Summary")), "=SUM(Main!B1:B3)");
  });

  test("renaming a tab rewrites references to it", () => {
    assert.equal(renameSheetInFormula("=January!A1+january!B2+Feb!A1", "January", "Jan 2026"), "='Jan 2026'!A1+'Jan 2026'!B2+Feb!A1");
    assert.equal(renameSheetInFormula("='Jan 2026'!A1", "Jan 2026", "Q1"), "='Q1'!A1");
  });
});

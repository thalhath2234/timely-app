import assert from "node:assert/strict";
import test, { describe } from "node:test";
import * as webFormula from "../apps/web/app/utils/sheetFormula.ts";
import * as mobileFormula from "../apps/mobile/lib/sheetFormula.ts";
import * as input from "../packages/contract/src/sheetFormulaInput.ts";

for (const [platform, formula] of [
  ["web", webFormula],
  ["mobile", mobileFormula],
]) {
  describe(platform, () => {
    const { createSheetEvaluator, shiftFormula } = formula;
    const { findFormulaRefAt } = input;
    const columns = Array.from({ length: 14 }, (_, i) => ({
      id: `c${i}`,
      name: `Column ${i}`,
      type: "number",
      width: 100,
    }));
    function evaluate(formula, values = ["10", "20", "30"], extraColumns = []) {
      const rows = values.map((value, i) => ({
        id: `r${i}`,
        cells: { c13: value },
      }));
      rows[0].cells.c0 = formula;
      return createSheetEvaluator([...columns, ...extraColumns], rows).valueAt(
        0,
        0,
      );
    }

    for (const [formula, value] of [
      ["=SUM(N:N)", 60],
      ["=SUM(N2:N)", 50],
      ["=SUM(N1:N)", 60],
      ["=SUM(N2:N3)", 50],
      ["=SUM(N3:N2)", 50],
      ["=SUM(2:2)", 20],
      ["=SUM(2:3)", 50],
      ["=SUM(B2:2)", 20],
      ["=SUM(M:N)", 60],
      ["=AVERAGE(N:N)", 20],
      ["=COUNT(N:N)", 3],
      ["=SUM(N99:N)", 0],
      ["=SUM(N2:N999999999)", 50],
      ["=SUM(N:N)+SUM(2:2)", 80],
      ["=10+SUM(N2:N)", 60],
      ["=SUM(N1:N2, N3:N)", 60],
    ]) {
      test(formula, () =>
        assert.deepEqual(evaluate(formula), { type: "number", value }),
      );
    }
    test("new rows automatically enter open ranges", () => {
      assert.deepEqual(evaluate("=SUM(N2:N)", ["10", "20", "30", "40"]), {
        type: "number",
        value: 90,
      });
    });
    test("new columns automatically enter whole rows", () => {
      const rows = [
        { id: "r1", cells: { c0: "=SUM(2:2)" } },
        { id: "r2", cells: { c13: "20", extra: "7" } },
      ];
      assert.deepEqual(createSheetEvaluator(columns, rows).valueAt(0, 0), {
        type: "number",
        value: 20,
      });
      assert.deepEqual(
        createSheetEvaluator(
          [
            ...columns,
            { id: "extra", name: "Extra", type: "number", width: 100 },
          ],
          rows,
        ).valueAt(0, 0),
        { type: "number", value: 27 },
      );
    });
    test("blanks and text do not affect sums", () =>
      assert.deepEqual(evaluate("=SUM(N:N)", ["Header", "", "30"]), {
        type: "number",
        value: 30,
      }));
    for (const formula of ["=SUM(A:A)", "=SUM(1:1)", "=SUM(A1:A)"]) {
      test(`cycle ${formula}`, () =>
        assert.deepEqual(evaluate(formula), {
          type: "error",
          message: "#CYCLE!",
        }));
    }
    for (const formula of ["=SUM(N0:N)", "=SUM(0:2)"]) {
      test(`invalid ${formula}`, () =>
        assert.deepEqual(evaluate(formula), {
          type: "error",
          message: "#REF!",
        }));
    }
    for (const formula of ["=SUM(2:N)", "=SUM(N:2)", "=SUM(N:)"]) {
      test(`malformed ${formula}`, () =>
        assert.equal(evaluate(formula).type, "error"));
    }
    test("fill shifts complete ranges, preserving strings", () => {
      assert.equal(
        shiftFormula('=SUM(N2:N,N:N,2:2)+B5+LEN("N2:N")', 1, 1),
        '=SUM(O3:O,O:O,3:3)+C6+LEN("N2:N")',
      );
    });
    for (const reference of ["N:N", "N2:N", "2:2", "B2:2", "N2:N21"]) {
      test(`editing recognizes ${reference}`, () => {
        const formula = `=SUM(${reference})`;
        assert.deepEqual(findFormulaRefAt(formula, 5 + reference.length), {
          start: 5,
          end: 5 + reference.length,
        });
        assert.equal(findFormulaRefAt(`=LEN("${reference}")`, 7), null);
      });
    }

    // Dates live in cells as YYYY-MM-DD text; 2026-10-03 is a Saturday.
    for (const [formula, expected] of [
      ['=WEEKDAY("2026-10-03")', { type: "number", value: 7 }],
      ['=WEEKDAY("2026-10-03",2)', { type: "number", value: 6 }],
      ['=WEEKDAY("2026-10-04",2)', { type: "number", value: 7 }],
      ['=WEEKDAY("2026-10-03",3)', { type: "number", value: 5 }],
      ['=TEXT("2026-10-03","dddd")', { type: "text", value: "Saturday" }],
      [
        '=TEXT("2026-10-03","ddd d mmm yyyy")',
        { type: "text", value: "Sat 3 Oct 2026" },
      ],
      [
        '=TEXT("2026-10-03T15:04:05Z","mmmm")',
        { type: "text", value: "October" },
      ],
      ['=TEXT("2026-01-05","dd/mm/yy")', { type: "text", value: "05/01/26" }],
      ['=TEXT(1234.5,"#,##0.00")', { type: "text", value: "1,234.50" }],
      ['=TEXT(0.256,"0.0%")', { type: "text", value: "25.6%" }],
      ['=YEAR("2026-10-03")', { type: "number", value: 2026 }],
      ['=MONTH("2026-10-03")', { type: "number", value: 10 }],
      ['=DAY("2026-10-03")', { type: "number", value: 3 }],
      ["=DATE(2026,10,3)", { type: "text", value: "2026-10-03" }],
      ["=DATE(2026,13,1)", { type: "text", value: "2027-01-01" }],
      ['=DAYS("2026-10-03","2026-09-30")', { type: "number", value: 3 }],
      ['=WEEKDAY("not a date")', { type: "error", message: "#VALUE!" }],
      ['=WEEKDAY("2026-10-03",9)', { type: "error", message: "#NUM!" }],
    ]) {
      test(formula, () => assert.deepEqual(evaluate(formula), expected));
    }
    test("date functions read date cells by reference", () => {
      const dateColumn = { id: "when", name: "When", type: "date", width: 100 };
      const rows = [
        { id: "r1", cells: { c0: '=TEXT(O1,"dddd")', when: "2026-10-05" } },
      ];
      assert.deepEqual(
        createSheetEvaluator([...columns, dateColumn], rows).valueAt(0, 0),
        { type: "text", value: "Monday" },
      );
    });
    test("TODAY is an ISO date", () => {
      const result = evaluate("=TODAY()");
      assert.equal(result.type, "text");
      assert.match(result.value, /^\d{4}-\d{2}-\d{2}$/);
    });
  });
}

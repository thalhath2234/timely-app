import assert from "node:assert/strict";
import test, { describe } from "node:test";
import * as formula from "../packages/contract/src/sheetFormula.ts";
import * as input from "../packages/contract/src/sheetFormulaInput.ts";

describe("sheetFormula", () => {
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

describe("sheetFormula functions and workbooks", () => {
  const { createSheetEvaluator } = formula;
  const letters = "ABCDEFGHIJ".split("");
  const columns = letters.map((id) => ({ id, name: id, width: 100, type: "text" }));
  // Date, Item, Category, Store, Qty, Unit, Price, Total
  const data = [
    ["2026-01-03", "Milk", "Groceries", "Keells", "2", "L", "450", "=E1*G1"],
    ["2026-01-05", "Bus pass", "Transport", "SLTB", "1", "month", "3000", "=E2*G2"],
    ["2026-01-09", "Rice", "Groceries", "Cargills", "5", "kg", "220", "=E3*G3"],
    ["2026-01-15", "Movie", "Fun", "Scope", "2", "ticket", "1200", "=E4*G4"],
  ];
  const rows = data.map((cells, r) => ({
    id: `r${r}`,
    cells: Object.fromEntries(cells.map((value, c) => [letters[c], value])),
  }));
  const tabs = [
    { id: "main", name: "Main", columns, rows },
    {
      id: "jan",
      name: "January",
      columns: [{ id: "a", name: "A", width: 1, type: "text" }],
      rows: [{ id: "1", cells: { a: "1" } }, { id: "2", cells: { a: "2" } }, { id: "3", cells: { a: "=A2*2" } }],
    },
    {
      id: "spend",
      name: "Jan Spend",
      columns: [{ id: "a", name: "A", width: 1, type: "text" }],
      rows: [{ id: "1", cells: { a: "=SUM(Main!H1:H4)" } }],
    },
  ];
  function ev(value) {
    const grid = structuredClone(rows);
    grid.push({ id: "x", cells: { J: value } });
    return createSheetEvaluator(columns, grid, { tabs: tabs.map((tab) => (tab.id === "main" ? { ...tab, rows: grid } : tab)), currentTabId: "main" }).valueAt(9, grid.length - 1);
  }
  const value = (result) => (result.type === "error" ? result.message : result.value);

  for (const [formulaText, expected] of [
    ["=E2*$G$1", 450],
    ["=G$1*2", 900],
    ['=SUMIF(C1:C4,"Groceries",H1:H4)', 2000],
    ['=SUMIF(C1:C4,"gro*",H1:H4)', 2000],
    ['=SUMIFS(H1:H4,C1:C4,"Groceries",D1:D4,"Keells")', 900],
    ['=COUNTIF(G1:G4,">1000")', 2],
    ['=COUNTIFS(C1:C4,"Groceries",G1:G4,"<300")', 1],
    ['=AVERAGEIF(C1:C4,"Groceries",H1:H4)', 1000],
    ['=SUMIFS(H1:H4,A1:A4,">=2026-01-05",A1:A4,"<=2026-01-10")', 4100],
    ['=MAXIFS(H1:H4,C1:C4,"Groceries")', 1100],
    ['=VLOOKUP("Rice",B1:H4,6,FALSE)', 220],
    ['=XLOOKUP("Movie",B1:B4,D1:D4)', "Scope"],
    ['=XLOOKUP("Tea",B1:B4,D1:D4,"none")', "none"],
    ['=INDEX(D1:D4,MATCH("Rice",B1:B4,0))', "Cargills"],
    ['=IFERROR(1/0,"none")', "none"],
    ['=IF("groceries"=C1,"same","different")', "same"],
    ['="He said ""hi"""', 'He said "hi"'],
    ['="a"&1+2', "a3"],
    ["=1e3+1", 1001],
    ["=A1+7", "2026-01-10"],
    ["=A2-A1", 2],
    ["=MAX(A1:A4)", "2026-01-15"],
    ['=TEXT(A1,"mmmm")', "January"],
    ["=ROUNDUP(2.341,1)", 2.4],
    ["=ROUND(2.675,2)", 2.68],
    ["=MOD(-3,5)", 2],
    ["=MEDIAN(G1:G4)", 825],
    ['=LEFT(B1,2)&RIGHT(B2,4)', "Mipass"],
    ['=SUBSTITUTE(B2," ","-")', "Bus-pass"],
    ['=PROPER("bus pass")', "Bus Pass"],
    ['=TEXTJOIN(", ",TRUE,B1:B2,"",B3)', "Milk, Bus pass, Rice"],
    ["=SUMPRODUCT(E1:E4,G1:G4)", 7400],
    ['=SUMPRODUCT((C1:C4="Groceries")*H1:H4)', 2000],
    ["=COUNTBLANK(I1:I4)", 4],
    ["=ISBLANK(I1)", true],
    ["=EOMONTH(A1,1)", "2026-02-28"],
    ["=EDATE(\"2026-01-31\",1)", "2026-02-28"],
    ['=DATEDIF("2026-01-15","2026-10-11","M")', 8],
    ['=NETWORKDAYS("2026-10-05","2026-10-16")', 10],
    ["=LARGE(G1:G4,2)", 1200],
    ["=RANK(3000,G1:G4)", 1],
    ['=SWITCH(C2,"Fun",1,"Transport",2,0)', 2],
    ['=IFS(G1>1000,"big",G1>100,"mid")', "mid"],
    ["=ROW()", 5],
    ["=January!A2", 2],
    ["=January!A3+1", 5],
    ["=SUM(January!A1:A3)", 7],
    ["=SUM(January!A:A)", 7],
    ["='Jan Spend'!A1", 7400],
    ["=Nope!A1", "#REF!"],
    ["=#REF!+1", "#REF!"],
    ["=ABC(1)", "#NAME?"],
    ["=SUM()", "#N/A"],
    ["=AVERAGE()", "#N/A"],
    ["=IF()", "#N/A"],
    ["=ABC()", "#NAME?"],
    ["=PI()", Math.PI],
  ]) {
    test(formulaText, () => {
      const result = value(ev(formulaText));
      if (typeof expected === "number") assert.ok(Math.abs(result - expected) < 1e-9, `${formulaText} → ${result}`);
      else assert.equal(result, expected);
    });
  }

  // What the grid stores when a formula is committed half-typed: open
  // parentheses are closed first, as in other spreadsheets.
  for (const [typed, expected] of [
    ["=SUM(", "#N/A"],
    ["=SUM(H1:", "#PARSE!"],
    ["=1+", "#PARSE!"],
    ["=SUM(H1:H4", 7400],
    // `H1:H` is an open range (H1 to the end of column H), not a typo.
    ["=SUM(H1:H", 7400],
  ]) {
    test(`committing ${typed}`, () => {
      assert.equal(value(ev(input.closeOpenParens(typed))), expected);
    });
  }

  test("cycles across tabs are caught", () => {
    const a = { id: "a", name: "A", columns: [{ id: "x", name: "X", width: 1, type: "text" }], rows: [{ id: "1", cells: { x: "=B!A1" } }] };
    const b = { id: "b", name: "B", columns: [{ id: "x", name: "X", width: 1, type: "text" }], rows: [{ id: "1", cells: { x: "=A!A1" } }] };
    const result = createSheetEvaluator(a.columns, a.rows, { tabs: [a, b], currentTabId: "a" }).valueAt(0, 0);
    assert.equal(result.message, "#CYCLE!");
  });

  test("a 5000-row running balance can be read from the bottom", () => {
    const grid = Array.from({ length: 5000 }, (_, r) => ({ id: `r${r}`, cells: { A: "1", B: r === 0 ? "=A1" : `=B${r}+A${r + 1}` } }));
    assert.deepEqual(createSheetEvaluator(columns, grid).valueAt(1, 4999), { type: "number", value: 5000 });
  });

  test("a summary tab reads month totals that are deep chains", () => {
    const month = { id: "m", name: "March", columns, rows: Array.from({ length: 3000 }, (_, r) => ({ id: `r${r}`, cells: { A: "2", B: r === 0 ? "=A1" : `=B${r}+A${r + 1}` } })) };
    const summary = { id: "s", name: "Summary", columns, rows: [{ id: "1", cells: { A: "=March!B3000" } }] };
    const result = createSheetEvaluator(summary.columns, summary.rows, { tabs: [summary, month], currentTabId: "s" }).valueAt(0, 0);
    assert.deepEqual(result, { type: "number", value: 6000 });
  });
});

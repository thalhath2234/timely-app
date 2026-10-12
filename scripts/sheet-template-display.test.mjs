import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { buildYearlyExpenses, MONTH_NAMES } from "../packages/contract/src/sheetTemplates.ts";
import { createSheetEvaluator } from "../packages/contract/src/sheetFormula.ts";
import {
  conditionalStyles,
  formatCurrency,
  formatDateValue,
  formatSheetCell,
} from "../packages/contract/src/sheetDisplay.ts";
import { editTextForCell, typedEntryForColumn } from "../packages/contract/src/sheetCell.ts";

function evaluatorFor(tabs, tabId) {
  const tab = tabs.find((t) => t.id === tabId);
  return createSheetEvaluator(tab.columns, tab.rows, { tabs, currentTabId: tabId });
}

describe("yearly expenses template", () => {
  test("has a summary, categories and a tab per month", () => {
    const sheet = buildYearlyExpenses({ year: 2026, currency: "LKR" });
    assert.equal(sheet.title, "Expenses 2026");
    assert.deepEqual(
      sheet.tabs.map((tab) => tab.name),
      ["Summary", "Categories", ...MONTH_NAMES],
    );
    const january = sheet.tabs[2];
    assert.deepEqual(
      january.columns.map((column) => column.name),
      ["Date", "Item", "Category", "Store / from", "Qty", "Unit", "Unit price", "Total", "Paid with", "Notes"],
    );
    assert.equal(january.frozenRows, 1);
    assert.equal(january.columns[6].format.currency, "LKR");
  });

  test("entries flow into month totals, the summary and categories", () => {
    const sheet = buildYearlyExpenses({ year: 2026 });
    const tabs = structuredClone(sheet.tabs);
    const january = tabs[2];
    const [date, item, category, store, qty, unit, price] = january.columns;
    const fill = (rowIndex, values) => {
      const cells = january.rows[rowIndex].cells;
      Object.assign(cells, {
        [date.id]: values[0],
        [item.id]: values[1],
        [category.id]: values[2],
        [store.id]: values[3],
        [qty.id]: values[4],
        [unit.id]: values[5],
        [price.id]: values[6],
      });
    };
    fill(1, ["2026-01-03", "Rice", "Groceries", "Keells", "5", "kg", "220"]);
    fill(2, ["2026-01-04", "Bus fare", "Transport", "SLTB", "", "trip", "80"]);
    fill(3, ["2026-01-05", "Milk", "Groceries", "Cargills", "2", "L", "450"]);
    tabs[0].rows[0].cells[tabs[0].columns[2].id] = "2000";

    const jan = evaluatorFor(tabs, january.id);
    assert.deepEqual(jan.valueAt(7, 1), { type: "number", value: 1100 });
    assert.deepEqual(jan.valueAt(7, 2), { type: "number", value: 80 }, "blank qty counts as one");
    assert.deepEqual(jan.valueAt(7, 0), { type: "number", value: 2080 });
    assert.deepEqual(jan.valueAt(1, 0), { type: "text", value: "Month total · 3 items" });
    assert.deepEqual(jan.valueAt(7, 10), { type: "text", value: "" });

    const summary = evaluatorFor(tabs, tabs[0].id);
    assert.deepEqual(summary.valueAt(1, 0), { type: "number", value: 2080 });
    assert.deepEqual(summary.valueAt(3, 0), { type: "number", value: -80 });
    assert.equal(summary.valueAt(4, 0).value, 1.04);
    assert.deepEqual(summary.valueAt(5, 0), { type: "number", value: 3 });
    assert.deepEqual(summary.valueAt(6, 0), { type: "number", value: 1100 });
    assert.deepEqual(summary.valueAt(1, 12), { type: "number", value: 2080 }, "year total");
    assert.deepEqual(summary.valueAt(1, 13), { type: "number", value: 2080 }, "average of months with spending");
    assert.deepEqual(summary.valueAt(1, 1), { type: "number", value: 0 });

    const categories = evaluatorFor(tabs, tabs[1].id);
    assert.deepEqual(categories.valueAt(1, 0), { type: "number", value: 2000 }, "January groceries");
    assert.deepEqual(categories.valueAt(13, 0), { type: "number", value: 2000 }, "groceries for the year");
    assert.deepEqual(categories.valueAt(13, 2), { type: "number", value: 80 }, "transport");
    assert.equal(Math.round(categories.valueAt(14, 0).value * 1000) / 1000, 0.962);
    const other = tabs[1].rows.length - 2;
    assert.deepEqual(categories.valueAt(0, other), { type: "text", value: "Other or none" });
    assert.deepEqual(categories.valueAt(1, other), { type: "number", value: 0 });

    const used = conditionalStyles(tabs[0].conditionalFormats, tabs[0].columns, tabs[0].rows.length, summary.valueAt);
    assert.ok(used.get("4:0")?.fillColor, "over budget is coloured");
    assert.equal(used.get("3:0")?.bold, true, "negative left is bold red");
    assert.equal(used.get("3:1"), undefined, "a month without a budget stays plain");

    // An entry with no category, and one outside the list, land in "Other or none".
    fill(4, ["2026-01-06", "Gift wrap", "", "Bookshop", "", "", "50"]);
    fill(5, ["2026-01-07", "Pet food", "Pets", "Pet shop", "", "", "70"]);
    const withOther = evaluatorFor(tabs, tabs[1].id);
    assert.deepEqual(withOther.valueAt(1, other), { type: "number", value: 120 });
    assert.deepEqual(withOther.valueAt(1, other + 1), { type: "number", value: 2200 }, "categories add up to the month");

    const faded = conditionalStyles(tabs[1].conditionalFormats, tabs[1].columns, tabs[1].rows.length, withOther.valueAt);
    assert.ok(faded.get("2:1")?.textColor, "an empty month fades");
    assert.equal(faded.get("1:0")?.textColor, undefined, "a month with spending does not");

    const big = conditionalStyles(january.conditionalFormats, january.columns, january.rows.length, jan.valueAt, january.frozenRows);
    assert.ok(big.get("7:1"), "above-average spend is marked");
    assert.equal(big.get("7:0"), undefined, "the frozen totals row is left alone");
  });
});

describe("sheet display", () => {
  test("currency uses the column's currency", () => {
    assert.match(formatCurrency(1250, "LKR"), /1,250\.00/);
    assert.match(formatCurrency(1250, "LKR"), /Rs|LKR/);
    assert.equal(formatCurrency(1250, ""), "1,250.00");
    assert.equal(formatCurrency(-5, "Rs"), "-Rs 5.00");
    assert.equal(formatCurrency(5, "€"), "€5.00");
  });

  test("date columns use their date style", () => {
    assert.equal(formatDateValue("2026-10-11", "d mmm"), "11 Oct");
    assert.equal(formatDateValue("2026-10-11", "ddd d mmm"), "Sun 11 Oct");
    assert.equal(formatDateValue("2026-10-11", undefined), "2026-10-11");
    const column = { type: "date", format: { dateFormat: "d mmm yyyy" } };
    assert.equal(formatSheetCell({ type: "text", value: "2026-10-11" }, column, "2026-10-11"), "11 Oct 2026");
    assert.equal(formatSheetCell({ type: "text", value: "soon" }, column, "soon"), "soon");
  });

  test("percent columns show percents and edit as percents", () => {
    assert.equal(formatSheetCell({ type: "number", value: 0.25 }, { type: "percent" }, "0.25"), "25.00%");
    assert.equal(formatSheetCell({ type: "number", value: 0.25 }, { type: "percent", format: { decimals: 0 } }, "0.25"), "25%");
    assert.equal(typedEntryForColumn("percent", "25"), "0.25");
    assert.equal(typedEntryForColumn("percent", "25%"), "25%");
    assert.equal(typedEntryForColumn("percent", "0.5"), "0.5");
    assert.equal(typedEntryForColumn("number", "25"), "25");
    assert.equal(editTextForCell("percent", "0.25"), "25%");
    assert.equal(editTextForCell("percent", "=A1"), "=A1");
  });

  test("conditional rules", () => {
    const columns = [{ id: "a" }, { id: "b" }];
    const values = [
      [{ type: "number", value: 5 }, { type: "text", value: "x" }],
      [{ type: "number", value: 50 }, { type: "text", value: "x" }],
      [{ type: "text", value: "pending" }, { type: "text", value: "y" }],
      [{ type: "empty" }, { type: "empty" }],
    ];
    const valueAt = (col, row) => values[row][col];
    const styles = (rule) => conditionalStyles([{ id: "r", fillColor: "#ff0000", ...rule }], columns, values.length, valueAt);
    assert.deepEqual([...styles({ columnId: "a", operator: "gt", value: "10" }).keys()], ["0:1"]);
    assert.deepEqual([...styles({ columnId: "a", operator: "between", value: "1", value2: "10" }).keys()], ["0:0"]);
    assert.deepEqual([...styles({ columnId: "a", operator: "empty" }).keys()], ["0:3"]);
    assert.deepEqual([...styles({ columnId: "b", operator: "duplicate" }).keys()].sort(), ["1:0", "1:1"]);
    assert.deepEqual([...styles({ columnId: "a", operator: "contains", value: "PEND", wholeRow: true }).keys()], ["0:2", "1:2"]);
    const both = conditionalStyles(
      [
        { id: "1", columnId: "a", operator: "gt", value: "1", fillColor: "#111111" },
        { id: "2", columnId: "a", operator: "gt", value: "10", fillColor: "#222222", bold: true },
      ],
      columns,
      values.length,
      valueAt,
    );
    assert.deepEqual(both.get("0:1"), { fillColor: "#111111", bold: true }, "earlier rules win");

    const withTotal = [...values.slice(0, 2), [{ type: "number", value: 55 }, { type: "empty" }]];
    const above = conditionalStyles(
      [{ id: "a", columnId: "a", operator: "aboveAverage", fillColor: "#333333" }],
      columns,
      withTotal.length,
      (col, row) => withTotal[row][col],
      0,
      new Set([2]),
    );
    assert.deepEqual([...above.keys()], ["0:1"], "a total row is not counted in the average or marked");
  });
});

test("the API's built-in template JSON matches the shared templates", async () => {
  const { readFileSync } = await import("node:fs");
  const { builtinSheetSkeleton, BUILTIN_SHEET_TEMPLATES } = await import("../packages/contract/src/sheetTemplates.ts");
  for (const template of BUILTIN_SHEET_TEMPLATES) {
    const name = template.id.replace(/^builtin:/, "");
    const file = new URL(`../apps/api/internal/features/sheet/builtin/${name}.json`, import.meta.url);
    assert.deepEqual(
      JSON.parse(readFileSync(file, "utf8")),
      JSON.parse(JSON.stringify(builtinSheetSkeleton(template.id))),
      `${name}.json is out of date: run make gen-sheet-builtins`,
    );
  }
});

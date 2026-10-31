import assert from "node:assert/strict";
import test, { describe } from "node:test";

const { reviewGroups, planGroups, reviewStats, reviewProgress, reviewName, reviewFields, reviewDate, reviewRepeat, columnForKey, currencyUnit } = await import(
  "../packages/contract/src/changeReview.ts"
);

// A sheet as the proposal stores it in each step's `before` (get_sheet).
const columns = [
  { id: "c_date", name: "Date", type: "date", width: 100, format: { dateFormat: "ddd d mmm" } },
  { id: "c_item", name: "Item", type: "text", width: 160 },
  { id: "c_cat", name: "Category", type: "select", width: 120 },
  { id: "c_qty", name: "Qty", type: "number", width: 60 },
  { id: "c_price", name: "Unit price", type: "currency", width: 110, format: { currency: "EUR" } },
  { id: "c_total", name: "Total", type: "currency", width: 110, format: { currency: "EUR" } },
  { id: "c_hidden", name: "Secret", type: "text", width: 80, hidden: true },
];
const sheet = {
  id: "sht_1",
  title: "Expenses 2026",
  icon: "💸",
  tabs: [
    { id: "tab_sep", name: "September", columns },
    { id: "tab_oct", name: "October", columns },
  ],
};

// Cells come back from Postgres jsonb shortest key first, not in column order.
const row = (tabId, date, item, price) => ({
  tool: "add_sheet_row",
  summary: `${item} ${price}`,
  arguments: { cells: { Qty: "1", Date: date, Item: item, "Unit price": price, Category: "Bills" }, tabId, sheetId: "sht_1" },
  status: "pending",
  before: { note: "", sheet, markdown: "" },
});

describe("reviewGroups: sheet entries", () => {
  const steps = [row("September", "2026-09-01", "Rent", "850"), row("September", "2026-09-04", "Rice", "24"), row("tab_oct", "2026-10-01", "Rent", "850")];

  test("many rows on one sheet are one group, one table per tab", () => {
    const groups = reviewGroups(steps);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(group.kind, "sheet");
    assert.equal(group.title, "Expenses 2026");
    assert.equal(group.icon, "💸");
    assert.equal(group.meta, "3 new entries in 2 tabs");
    assert.deepEqual(group.steps, [0, 1, 2]);
    assert.deepEqual(
      group.tabs.map((tab) => [tab.name, tab.rows.length]),
      [
        ["September", 2],
        ["October", 1],
      ],
    );
  });

  test("columns follow the sheet's order, only those filled, currency sign in the heading", () => {
    const [tab] = reviewGroups(steps)[0].tabs;
    assert.deepEqual(
      tab.columns.map((column) => column.name),
      ["Date", "Item", "Category", "Qty", "Unit price"],
    );
    assert.equal(tab.columns[4].unit, "€");
    assert.equal(tab.columns[4].numeric, true);
    assert.deepEqual(tab.rows[0].cells, ["Tue 1 Sep", "Rent", "Bills", "1", "850.00"]);
    assert.deepEqual([tab.lead, tab.date, tab.amount], [1, 0, 4]);
    assert.deepEqual(tab.same, []);
  });

  test("a value every entry shares is said once, not in each row", () => {
    const three = [row("September", "2026-09-01", "Rent", "850"), row("September", "2026-09-04", "Rice", "24"), row("September", "2026-09-05", "Milk", "3")];
    const [tab] = reviewGroups(three)[0].tabs;
    assert.deepEqual(tab.same, [
      { label: "Category", value: "Bills" },
      { label: "Qty", value: "1" },
    ]);
    assert.deepEqual(
      tab.columns.map((column) => column.name),
      ["Date", "Item", "Unit price"],
    );
    assert.deepEqual(tab.rows[2].cells, ["Sat 5 Sep", "Milk", "3.00"]);
    assert.deepEqual([tab.lead, tab.date, tab.amount], [1, 0, 2]);
  });

  test("an applied add_sheet_entries shows the totals the sheet worked out", () => {
    const entries = {
      tool: "add_sheet_entries",
      summary: "Add 2 entries to September",
      arguments: {
        tabId: "September",
        sheetId: "sht_1",
        entries: [{ cells: { Item: "Rent", "Unit price": "850", Qty: "1" } }, { cells: { Item: "Rice", "Unit price": "12", Qty: "2" } }],
      },
      status: "done",
      before: { sheet },
      result: { rows: [2, 3], values: [{ Item: "Rent", Total: 850 }, { Item: "Rice", Total: 24 }] },
    };
    const [group] = reviewGroups([entries]);
    const [tab] = group.tabs;
    assert.deepEqual(
      tab.columns.map((column) => column.name),
      ["Item", "Qty", "Unit price", "Total"],
    );
    assert.deepEqual(tab.rows[1].cells, ["Rice", "2", "12.00", "24.00"]);
    assert.equal(tab.amount, 3);
    assert.deepEqual(reviewProgress(group, [entries]), { state: "done", done: 1, total: 1 });
  });

  test("a sheet the review cannot read still shows its cells, never its id", () => {
    const bare = { ...row("September", "2026-09-01", "Rent", "850"), before: undefined };
    const [group] = reviewGroups([bare]);
    assert.equal(group.title, "A sheet");
    assert.equal(group.tabs[0].name, "September");
    assert.ok(group.tabs[0].columns.some((column) => column.name === "Item"));
  });
});

describe("reviewGroups: tasks, docs and the rest", () => {
  const names = {
    workspace: (id) => ({ ws_1: "Personal" })[id],
    project: (id) => ({ pr_1: "Launch" })[id],
  };
  const steps = [
    { tool: "create_task", summary: "Create Draft", arguments: { name: "Draft", deadline: "2026-11-04", duration: 90, projectId: "pr_1", workspaceId: "ws_1" }, status: "pending" },
    {
      tool: "update_task",
      summary: "Move notes",
      arguments: { taskId: "tsk_9", deadline: "2026-11-04", duration: 60 },
      status: "pending",
      before: { task: { name: "Release notes", deadline: "2026-11-03", duration: 45 } },
    },
    { tool: "create_doc", summary: "Create doc", arguments: { title: "Trip", markdown: "# Trip\n\n- [ ] Flights\n- [x] Insurance\n- Notes" }, status: "pending" },
    { tool: "complete_task", summary: "Done", arguments: { taskId: "$0.task.id" }, status: "pending" },
    { tool: "delete_label", summary: "Delete label Old", arguments: { labelId: "lbl_7" }, status: "pending" },
  ];
  const groups = reviewGroups(steps, names);

  test("every task change is one group, in the place of its first step", () => {
    assert.deepEqual(
      groups.map((group) => group.kind),
      ["tasks", "doc", "change"],
    );
    const tasks = groups[0];
    assert.deepEqual(tasks.steps, [0, 1, 3]);
    assert.equal(tasks.meta, "1 new, 2 changes");
    assert.deepEqual(tasks.rows[0].meta, ["Personal › Launch", "Due Wed 4 Nov", "1 h 30 min"]);
  });

  test("a place every task shares is said once, on the group", () => {
    const two = [steps[0], { ...steps[0], arguments: { ...steps[0].arguments, name: "Record" } }];
    const [group] = reviewGroups(two, names);
    assert.equal(group.meta, "Personal › Launch · 2 new");
    assert.deepEqual(group.rows[1].meta, ["Due Wed 4 Nov", "1 h 30 min"]);
  });

  test("an edit shows each value before and after", () => {
    const edit = groups[0].rows[1];
    assert.equal(edit.title, "Release notes");
    assert.deepEqual(edit.changes, [
      { label: "Due", value: "Wed 4 Nov 2026", was: "Tue 3 Nov 2026" },
      { label: "Length", value: "1 h", was: "45 min" },
    ]);
  });

  test("a step on a task made earlier names it", () => {
    assert.equal(groups[0].rows[2].title, "New task “Draft”");
  });

  test("a doc shows real checklist items and its title once", () => {
    const doc = groups[1];
    assert.equal(doc.title, "Trip");
    assert.equal(doc.meta, "3 checklist items");
    assert.deepEqual(
      doc.blocks.map((block) => [block.kind, block.checked]),
      [
        ["check", false],
        ["check", true],
        ["check", false],
      ],
    );
  });

  test("a deletion names what goes from the copy read before it", () => {
    const [group] = reviewGroups([{ tool: "delete_task", summary: "Delete task", arguments: { taskId: "tsk_1" }, status: "pending", before: { task: { name: "Old draft" } } }]);
    assert.equal(group.meta, "Removes “Old draft”");
  });

  test("reviewStats sums the plan up for the strip above the cards", () => {
    assert.deepEqual(reviewStats(groups), [
      { value: 1, label: "New task" },
      { value: 2, label: "Task changes" },
      { value: 1, label: "New doc" },
      { value: 1, label: "Removal" },
    ]);
  });

  test("planGroups counts changes the way the review draws them", () => {
    assert.deepEqual(
      planGroups(steps).map((group) => group.steps),
      [[0, 1, 3], [2], [4]],
    );
  });

  test("a deletion is drawn as a removal and names what it removes by kind", () => {
    const change = groups[2];
    assert.equal(change.removal, true);
    assert.deepEqual(change.fields, [{ label: "Label", value: "A label" }]);
  });
});

describe("reviewGroups: a sheet's structure", () => {
  test("columns and rows written in one step read as their table", () => {
    const [group] = reviewGroups([
      {
        tool: "update_sheet",
        summary: "Add columns and rows",
        status: "pending",
        arguments: {
          sheetId: "$0.sheet.id",
          columns: [
            { id: "item", name: "Item", type: "text" },
            { id: "quantity", name: "Quantity", type: "number" },
            { id: "price", name: "Unit price", type: "currency", format: { currency: "EUR" } },
            { id: "total", name: "Total", type: "formula" },
          ],
          rows: [{ cells: { item: "Hosting", quantity: "1", price: "25", total: "=B1*C1" } }],
        },
      },
    ]);
    assert.equal(group.kind, "change");
    assert.deepEqual(
      group.table.columns.map((column) => [column.name, column.unit]),
      [
        ["Item", undefined],
        ["Quantity", undefined],
        ["Unit price", "€"],
        ["Total", undefined],
      ],
    );
    assert.deepEqual(group.table.rows[0].cells, ["Hosting", "1", "25.00", "=B1*C1"]);
    assert.ok(!group.fields.some((field) => field.label === "Columns" || field.label === "Rows"));
  });
});

describe("values", () => {
  test("ids become names or kinds", () => {
    assert.equal(reviewName("pr_1", { project: () => "Launch" }), "Launch");
    assert.equal(reviewName("ws_404", {}), "A workspace");
  });
  test("fields hide plumbing and order the important ones first", () => {
    const fields = reviewFields({ timezone: "UTC", deadline: "2026-11-04", name: "Draft", projectId: "pr_1" }, { project: () => "Launch" });
    assert.deepEqual(
      fields.map((field) => `${field.label}: ${field.value}`),
      ["Name: Draft", "Project: Launch", "Due: Wed 4 Nov 2026"],
    );
  });
  test("dates, repeats and currencies read as words", () => {
    assert.equal(reviewDate("2026-11-04"), "Wed 4 Nov");
    assert.equal(reviewDate("2026-11-04T00:00:00Z"), "Wed 4 Nov");
    assert.equal(reviewRepeat({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE" }), "Every week on Mon, Wed");
    assert.equal(currencyUnit("EUR"), "€");
    assert.equal(currencyUnit(undefined), undefined);
  });
  test("a cell key finds its column by id, name, copied heading or letter", () => {
    assert.equal(columnForKey(columns, "c_qty").name, "Qty");
    assert.equal(columnForKey(columns, "unit price").name, "Unit price");
    assert.equal(columnForKey(columns, "E Unit price (EUR)").name, "Unit price");
    assert.equal(columnForKey(columns, "B").name, "Item");
  });
});

describe("reviewProgress", () => {
  const steps = [
    { tool: "add_sheet_row", status: "done", arguments: {}, summary: "" },
    { tool: "add_sheet_row", status: "pending", arguments: {}, summary: "" },
    { tool: "add_sheet_row", status: "failed", error: "No such tab", arguments: {}, summary: "" },
  ];
  test("a group is as far along as its own steps", () => {
    assert.deepEqual(reviewProgress({ steps: [0, 1] }, steps), { state: "partial", done: 1, total: 2 });
    assert.deepEqual(reviewProgress({ steps: [0, 1] }, steps, 1), { state: "active", done: 1, total: 2 });
    assert.deepEqual(reviewProgress({ steps: [0, 2] }, steps), { state: "failed", done: 1, total: 2, error: "No such tab" });
  });
});

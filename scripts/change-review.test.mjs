import assert from "node:assert/strict";
import test, { describe } from "node:test";

const { reviewGroups, planGroups, reviewStats, reviewProgress, reviewName, reviewFields, reviewDate, reviewRepeat, columnForKey, currencyUnit, isBotPlan, botAlertsLine, botPlanHint } = await import(
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

  test("a cell change joins the sheet's entries and names the row, with its value before", () => {
    const amount = { id: "c_amt", name: "Amount", type: "currency", width: 100, format: { currency: "EUR" } };
    const item = { id: "c_item", name: "Item", type: "text", width: 160 };
    const expenses = { id: "sht_2", title: "Monthly expenses", tabs: [{ id: "", name: "Sheet" }] };
    const read = { sheet: expenses, tab: { columns: [item, amount], rows: [{ id: "r1", cells: { c_item: "Rent", c_amt: "850" } }, { id: "r2", cells: { c_item: "Internet", c_amt: "45" } }] } };
    const edit = { tool: "update_sheet_cells", summary: "Change Internet amount from 45 to 50", arguments: { sheetId: "sht_2", rowId: "r2", cells: { Amount: "50" } }, status: "pending", before: read };
    const entry = { tool: "add_sheet_row", summary: "Add Gym 30", arguments: { sheetId: "sht_2", cells: { Item: "Gym", Amount: "30" } }, status: "pending", before: read };
    const groups = reviewGroups([edit, entry]);
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(group.kind, "sheet");
    assert.equal(group.title, "Monthly expenses");
    assert.deepEqual(group.steps, [0, 1]);
    assert.equal(group.meta, "1 change · 1 new entry");
    assert.deepEqual(group.fields, [{ label: "Internet · Amount", value: "€50.00", was: "€45.00" }]);
    assert.ok(!JSON.stringify(group).includes("r2"), "the row id is never shown");
    assert.deepEqual(reviewStats(groups), [
      { value: 1, label: "Sheet entry" },
      { value: 1, label: "Sheet change" },
    ]);
    // A row given by number, on a sheet the review read without rows.
    const [byNumber] = reviewGroups([{ ...edit, arguments: { sheetId: "sht_2", row: 2, cells: { Amount: "50" } }, before: { sheet: expenses } }]);
    assert.equal(byNumber.meta, "1 change");
    assert.deepEqual(byNumber.fields, [{ label: "Row 2 · Amount", value: "50" }]);
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

describe("reviewGroups: bots", () => {
  const shop = { kind: "page", url: "https://www.amazon.in/dp/B0DFC8QZ4M", read: "product_price", rules: [{ kind: "below", threshold: 18000 }] };
  const preview = {
    watches: [
      {
        index: 0,
        watchId: "",
        ok: true,
        kind: "page",
        read: "product_price",
        site: "amazon.in",
        summary: "₹19,999",
        value: 19999,
        currency: "INR",
        text: "",
        items: null,
        excerpt: { text: "M.R.P.: Rs 22,900 Deal Price: Rs 19,999", mark: [30, 39], struck: [[8, 17]] },
        candidates: [{ label: "Deal Price", amount: 19999, currency: "INR", selector: "span.a-price-whole", struck: false, from: "text" }],
        health: null,
        at: "2026-11-07T10:00:00Z",
      },
    ],
  };
  const create = (watches, extra = {}) => ({
    tool: "create_bot",
    summary: "Make a bot",
    arguments: { name: "Pixel Buds Pro 2 under ₹18,000", description: "tell me when these earbuds drop", intervalMinutes: 0, watches },
    status: "pending",
    ...extra,
  });

  test("a new bot is one card with grouped rows, the reading and the alert defaults", () => {
    const [group] = reviewGroups([create([shop], { preview })]);
    assert.equal(group.kind, "bot");
    assert.equal(group.key, "bot:0");
    assert.equal(group.action, "create");
    assert.equal(group.eyebrow, "Bot");
    assert.equal(group.title, "Pixel Buds Pro 2 under ₹18,000");
    assert.deepEqual(
      group.rows.map((r) => [r.label, r.value]),
      [
        ["Watches", "amazon.in · Product price"],
        ["Checks every", "6 hours"],
        ["Tells me when", "Price is below ₹18,000"],
        ["How smart", "Rules only"],
        ["Alerts on", "Desktop, Phone"],
      ],
    );
    assert.equal(group.rows[0].site, "amazon.in");
    assert.equal(group.rows[0].kind, "page");
    assert.equal(group.rows.some((r) => r.watch), false, "one watch needs no sub-labels");
    assert.equal(group.preview.watches[0].summary, "₹19,999");
    assert.equal(group.args.intervalMinutes, 360);
    assert.equal(group.args.watches[0].currency, "INR");
  });

  test("the person's alert defaults show on a new bot", () => {
    const [group] = reviewGroups([create([shop])], { botDefaults: { desktop: false, phone: true, urgent: true } });
    assert.equal(group.rows.at(-1).value, "Phone, urgent");
    assert.equal(botAlertsLine({ desktop: false, phone: false, urgent: false }), "Only on the Bots page");
  });

  test("two watches label each watch and put a sub-label on each rule", () => {
    const feed = { kind: "feed", url: "https://go.dev/blog/feed.atom" };
    const coin = { kind: "price", source: "crypto", symbol: "BTC", currency: "USD", rules: [{ kind: "above", threshold: 100000 }, { kind: "move_pct", percent: 5, direction: "any" }] };
    const [group] = reviewGroups([create([feed, coin])]);
    assert.deepEqual(
      group.rows.filter((r) => r.label.startsWith("Watch")).map((r) => [r.label, r.value, r.site ?? ""]),
      [
        ["Watch 1", "go.dev · Feed", "go.dev"],
        ["Watch 2", "BTC-USD · Coinbase", ""],
      ],
    );
    assert.deepEqual(
      group.rows.filter((r) => r.label === "Tells me when").map((r) => [r.watch, r.value]),
      [
        ["go.dev · Feed", "A new post"],
        ["BTC-USD · Coinbase", "Price is above $100,000"],
        ["BTC-USD · Coinbase", "Moves 5% either way"],
      ],
    );
    // A feed and a price: the default is the feed's half hour.
    assert.equal(group.rows.find((r) => r.label === "Checks every").value, "30 minutes");
    assert.deepEqual(group.rows.filter((r) => r.label === "Tells me when").map((r) => r.watchIndex), [0, 1, 1]);
  });

  test("two watches on one site keep their own sub-labels, numbered", () => {
    const other = { ...shop, url: "https://www.amazon.in/dp/B0CX23V2ZK", rules: [{ kind: "below", threshold: 200 }] };
    const [group] = reviewGroups([create([{ ...shop, rules: [{ kind: "below", threshold: 100 }] }, other])]);
    assert.deepEqual(
      group.rows.filter((r) => r.label === "Tells me when").map((r) => [r.watchIndex, r.watch, r.value]),
      [
        [0, "Watch 1 · amazon.in · Product price", "Price is below 100"],
        [1, "Watch 2 · amazon.in · Product price", "Price is below 200"],
      ],
    );
  });

  test("a watch without rules shows the rule the server gives it", () => {
    const [group] = reviewGroups([create([{ kind: "page", url: "https://example.com/visa", read: "selector", selector: "#slots" }])]);
    assert.equal(group.rows.find((r) => r.label === "Tells me when").value, "Any change");
    const [shopDefault] = reviewGroups([create([{ ...shop, rules: [] }], { preview })]);
    assert.equal(shopDefault.rows.find((r) => r.label === "Tells me when").value, "Drops 5%");
  });

  test("a failed reading is kept as the reason, not a preview", () => {
    const [group] = reviewGroups([create([shop], { preview: { error: "The site asks not to be read" } })]);
    assert.equal(group.preview, undefined);
    assert.equal(group.previewError, "The site asks not to be read");
  });

  test("an edit names the bot from its read and shows what each row was", () => {
    const before = {
      id: "bot_1",
      name: "Earbuds",
      description: "",
      status: "active",
      intervalMinutes: 360,
      desktop: true,
      phone: false,
      urgent: false,
      watches: [
        { id: "bwt_1", kind: "page", url: "https://www.amazon.in/dp/B0DFC8QZ4M", read: "product_price", selector: "", source: "", symbol: "", currency: "INR", rules: [{ kind: "below", threshold: 18000 }] },
        { id: "bwt_2", kind: "feed", url: "https://go.dev/blog/feed.atom", read: "", selector: "", source: "", symbol: "", currency: "", rules: [{ kind: "new_item" }] },
      ],
    };
    const step = {
      tool: "update_bot",
      summary: "Change the line",
      arguments: {
        bot: "bot_1",
        intervalMinutes: 720,
        watches: [{ id: "bwt_1", kind: "page", url: "https://www.amazon.in/dp/B0DFC8QZ4M", read: "selector_price", selector: "span.a-price-whole", rules: [{ kind: "below", threshold: 17000 }] }],
      },
      status: "pending",
      before,
    };
    const [group] = reviewGroups([step]);
    assert.equal(group.action, "update");
    assert.equal(group.title, "Earbuds");
    assert.equal(group.botId, "bot_1");
    const row = (label) => group.rows.find((r) => r.label === label);
    assert.equal(row("Watches").value, "amazon.in · One price on the page");
    assert.equal(row("Watches").before, "amazon.in · Product price");
    assert.equal(row("Stops watching").value, "go.dev · Feed");
    assert.deepEqual([row("Checks every").value, row("Checks every").before], ["12 hours", "6 hours"]);
    assert.deepEqual([row("Tells me when").value, row("Tells me when").before], ["Price is below ₹17,000", "Price is below ₹18,000"]);
    assert.equal(row("Alerts on").value, "Desktop");
    assert.equal(row("Alerts on").before, undefined);
  });

  test("an edit that leaves a watch's rules out keeps them", () => {
    const before = { id: "bot_1", name: "Coin", intervalMinutes: 15, desktop: true, phone: true, urgent: false, watches: [{ id: "bwt_1", kind: "price", source: "coinbase", symbol: "BTC", currency: "USD", rules: [{ kind: "below", threshold: 90000 }] }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "Coin", name: "Bitcoin", watches: [{ id: "bwt_1", kind: "price", source: "coinbase", symbol: "BTC", currency: "USD" }] }, status: "pending", before };
    const [group] = reviewGroups([step]);
    assert.deepEqual(group.rows.find((r) => r.label === "Name"), { label: "Name", value: "Bitcoin", before: "Coin" });
    const rule = group.rows.find((r) => r.label === "Tells me when");
    assert.equal(rule.value, "Price is below $90,000");
    assert.equal(rule.before, undefined);
    assert.equal(group.rows.find((r) => r.label === "Watches").before, undefined);
  });

  test("an edit without an interval rises to its new watches' floor, as the server saves it", () => {
    const before = { id: "bot_1", name: "Earbuds", intervalMinutes: 60, desktop: true, phone: false, urgent: false, watches: [{ id: "bwt_1", kind: "page", url: "https://www.amazon.in/dp/B0DFC8QZ4M", read: "text", rules: [{ kind: "changed" }] }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_1", watches: [{ id: "bwt_1", kind: "page", url: "https://www.amazon.in/dp/B0DFC8QZ4M", read: "product_price" }] }, status: "pending", before };
    const [group] = reviewGroups([step]);
    const every = group.rows.find((r) => r.label === "Checks every");
    assert.deepEqual([every.value, every.before], ["6 hours", "1 hour"]);
    assert.equal(group.args.intervalMinutes, 360);
    // Above the floor, the interval stays as it was.
    const [kept] = reviewGroups([{ ...step, before: { ...before, intervalMinutes: 720 } }]);
    assert.deepEqual([kept.rows.find((r) => r.label === "Checks every").value, kept.rows.find((r) => r.label === "Checks every").before], ["12 hours", undefined]);
  });

  test("an edit to the description shows what it was", () => {
    const before = { id: "bot_1", name: "Coin", description: "watch bitcoin", intervalMinutes: 15, desktop: true, phone: true, urgent: false, watches: [{ id: "bwt_1", kind: "price", source: "coinbase", symbol: "BTC", currency: "USD", rules: [{ kind: "below", threshold: 90000 }] }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_1", description: "tell me when bitcoin dips" }, status: "pending", before };
    const [group] = reviewGroups([step]);
    assert.deepEqual(group.rows.find((r) => r.label === "Description"), { label: "Description", value: "tell me when bitcoin dips", before: "watch bitcoin" });
    assert.equal(group.args.description, "tell me when bitcoin dips");
    const [same] = reviewGroups([{ ...step, arguments: { bot: "bot_1", name: "Coin" } }]);
    assert.equal(same.rows.some((r) => r.label === "Description"), false);
  });

  test("a bot counts as one change, and a bot-only plan reads as one", () => {
    const steps = [create([shop]), { ...create([shop]), tool: "update_bot", arguments: { bot: "bot_9", name: "Other" } }];
    const groups = reviewGroups(steps, { bot: (id) => (id === "bot_9" ? "Other bot" : undefined) });
    assert.deepEqual(planGroups(steps).map((g) => [g.key, g.kind]), [["bot:0", "bot"], ["bot:1", "bot"]]);
    assert.deepEqual(reviewStats(groups), [
      { value: 1, label: "New bot" },
      { value: 1, label: "Bot change" },
    ]);
    assert.equal(isBotPlan(steps), true);
    assert.equal(isBotPlan([...steps, { tool: "create_task", arguments: {} }]), false);
    assert.equal(isBotPlan([]), false);
    assert.equal(reviewName("bot_9", { bot: () => "Other bot" }), "Other bot");
    assert.equal(reviewName("bot_8", {}), "A bot");
  });

  test("a created bot carries its id for Open bot", () => {
    const [group] = reviewGroups([create([shop], { status: "done", result: { id: "bot_new", name: "Pixel Buds Pro 2 under ₹18,000" } })]);
    assert.equal(group.botId, "bot_new");
  });

  test("How smart reads what the step sets, else what the bot has, with what it was", () => {
    const [made] = reviewGroups([create([shop], { arguments: { ...create([shop]).arguments, judgeMode: "ai" } })]);
    assert.deepEqual(made.rows.find((r) => r.label === "How smart"), { label: "How smart", value: "AI judges" });
    assert.equal(made.args.judgeMode, "ai");
    const before = { id: "bot_1", name: "Coin", judgeMode: "rules", intervalMinutes: 15, desktop: true, phone: true, urgent: false, watches: [{ id: "bwt_1", kind: "price", source: "coinbase", symbol: "BTC", currency: "USD", rules: [{ kind: "below", threshold: 90000 }] }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_1", judgeMode: "ai" }, status: "pending", before };
    const [turned] = reviewGroups([step]);
    assert.deepEqual(turned.rows.find((r) => r.label === "How smart"), { label: "How smart", value: "AI judges", before: "Rules only" });
    // An edit that leaves it out keeps the bot's own, with nothing struck.
    const [kept] = reviewGroups([{ ...step, arguments: { bot: "bot_1", name: "Bitcoin" }, before: { ...before, judgeMode: "ai" } }]);
    assert.deepEqual(kept.rows.find((r) => r.label === "How smart"), { label: "How smart", value: "AI judges" });
  });

  test("Knowledge names the doc or sheet, never its id, with what it was", () => {
    const names = { doc: (id) => (id === "doc_1" ? "Wishlist notes" : undefined), sheet: (id) => (id === "sht_1" ? { title: "Wishlist" } : undefined) };
    const [made] = reviewGroups([create([shop], { arguments: { ...create([shop]).arguments, judgeMode: "ai", knowledge: { kind: "sheet", id: "sht_1" } } })], names);
    assert.deepEqual(made.rows.find((r) => r.label === "Knowledge"), { label: "Knowledge", value: "Wishlist" });
    assert.deepEqual(made.args.knowledge, { kind: "sheet", id: "sht_1" });
    const [unknown] = reviewGroups([create([shop], { arguments: { ...create([shop]).arguments, knowledge: { kind: "doc", id: "doc_9" } } })], names);
    assert.equal(unknown.rows.find((r) => r.label === "Knowledge").value, "A doc");
    const before = { id: "bot_1", name: "Earbuds", judgeMode: "ai", knowledge: { kind: "doc", id: "doc_1", title: "Old notes" }, intervalMinutes: 360, desktop: true, phone: true, urgent: false, watches: [{ ...shop, id: "bwt_1" }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_1", knowledge: { kind: "sheet", id: "sht_1" } }, status: "pending", before };
    assert.deepEqual(reviewGroups([step], names)[0].rows.find((r) => r.label === "Knowledge"), { label: "Knowledge", value: "Wishlist", before: "Old notes" });
    // null clears it.
    assert.deepEqual(reviewGroups([{ ...step, arguments: { bot: "bot_1", knowledge: null } }], names)[0].rows.find((r) => r.label === "Knowledge"), { label: "Knowledge", value: "None", before: "Old notes" });
    // Left out, it stays as the bot has it.
    assert.deepEqual(reviewGroups([{ ...step, arguments: { bot: "bot_1", name: "Buds" } }], names)[0].rows.find((r) => r.label === "Knowledge"), { label: "Knowledge", value: "Old notes" });
    // A bot without knowledge shows no row.
    assert.equal(reviewGroups([create([shop])])[0].rows.some((r) => r.label === "Knowledge"), false);
  });

  test("Passes to shows one row per link, what each was, and the links it stops", () => {
    const feed = { id: "bwt_1", kind: "feed", url: "https://www.reddit.com/r/buildapcsales/.rss", read: "", selector: "", source: "", symbol: "", currency: "", rules: [{ kind: "new_item" }] };
    const before = {
      id: "bot_feed",
      name: "Deals feed",
      intervalMinutes: 30,
      desktop: true,
      phone: true,
      urgent: false,
      watches: [feed],
      passesTo: [
        { bot: "Price check", botId: "bot_price", filter: ["2TB"], enabled: true },
        { bot: "GPU deals", botId: "bot_gpu", filter: [], enabled: true },
      ],
    };
    const step = {
      tool: "update_bot",
      summary: "Check the price before telling me",
      arguments: { bot: "bot_feed", passesTo: [{ bot: "bot_price", filter: ["2TB", "NVMe"] }, { bot: "bot_steam", filter: [] }] },
      status: "pending",
      before,
    };
    const [group] = reviewGroups([step], { bot: (id) => (id === "bot_steam" ? "Steam Deck OLED" : undefined) });
    assert.deepEqual(
      group.rows.filter((r) => /pass/i.test(r.label)).map((r) => [r.label, r.value, r.before]),
      [
        ["Passes to", "Price check · mentions 2TB or NVMe", "Price check · mentions 2TB"],
        ["Passes to", "Steam Deck OLED · Everything it finds", "New"],
        ["Stops passing to", "GPU deals · Everything it finds", undefined],
      ],
    );
    assert.deepEqual(group.args.passesTo, [{ botId: "bot_price", filter: ["2TB", "NVMe"] }, { botId: "bot_steam", filter: [] }]);
    // A link named by its bot's name matches the one it had, and an unknown id never shows.
    const [named] = reviewGroups([{ ...step, arguments: { bot: "bot_feed", passesTo: [{ bot: "price check", filter: ["2TB"] }, { bot: "bot_zzz" }] } }]);
    assert.deepEqual(
      named.rows.filter((r) => /pass/i.test(r.label)).map((r) => [r.label, r.value, r.before]),
      [
        ["Passes to", "Price check · mentions 2TB", undefined],
        ["Passes to", "A bot · Everything it finds", "New"],
        ["Stops passing to", "GPU deals · Everything it finds", undefined],
      ],
    );
    // An edit that leaves the links out shows them as they are.
    const [kept] = reviewGroups([{ ...step, arguments: { bot: "bot_feed", name: "Deals" } }]);
    assert.deepEqual(kept.rows.filter((r) => r.label === "Passes to").map((r) => [r.value, r.before]), [
      ["Price check · mentions 2TB", undefined],
      ["GPU deals · Everything it finds", undefined],
    ]);
  });

  test("a brief sums up bots instead of watching, and sends daily", () => {
    const step = {
      tool: "create_bot",
      summary: "Make a morning brief",
      arguments: { name: "Morning brief", description: "Each morning, sum up what my other bots found.", intervalMinutes: 1440, kind: "brief", sources: ["bot_gpu", "Bitcoin under $70,000"], briefTime: "07:00", briefAi: true, watches: [] },
      status: "pending",
    };
    const [group] = reviewGroups([step], { bot: (id) => (id === "bot_gpu" ? "GPU deals" : undefined) });
    assert.equal(group.meta, "Daily at 07:00");
    assert.deepEqual(
      group.rows.map((r) => [r.label, r.value]),
      [
        ["Sums up", "GPU deals"],
        ["Sums up", "Bitcoin under $70,000"],
        ["Sends", "Daily at 07:00"],
        ["Written by", "AI"],
        ["Alerts on", "Desktop, Phone"],
      ],
    );
    assert.equal(group.preview, undefined);
    assert.deepEqual(
      { kind: group.args.kind, sources: group.args.sources, briefTime: group.args.briefTime, briefAi: group.args.briefAi, watches: group.args.watches, intervalMinutes: group.args.intervalMinutes },
      { kind: "brief", sources: ["bot_gpu", "Bitcoin under $70,000"], briefTime: "07:00", briefAi: true, watches: [], intervalMinutes: 1440 },
    );
    // Without a time or AI: 08:00, written by Timely.
    const [plain] = reviewGroups([{ ...step, arguments: { ...step.arguments, briefTime: undefined, briefAi: undefined } }]);
    assert.equal(plain.meta, "Daily at 08:00");
    assert.deepEqual(plain.rows.filter((r) => r.label === "Sends" || r.label === "Written by").map((r) => r.value), ["Daily at 08:00", "Timely"]);
  });

  test("an edit to a brief shows its sources, time and writer as they were", () => {
    const before = {
      id: "bot_brief",
      name: "Morning brief",
      kind: "brief",
      intervalMinutes: 1440,
      desktop: true,
      phone: false,
      urgent: false,
      watches: [],
      sources: [
        { botId: "bot_gpu", name: "GPU deals" },
        { botId: "bot_btc", name: "Bitcoin under $70,000" },
      ],
      briefTime: "08:00",
      briefAi: false,
    };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_brief", sources: ["bot_gpu", "bot_sony"], briefTime: "06:00", briefAi: true }, status: "pending", before };
    const [group] = reviewGroups([step], { bot: (id) => (id === "bot_sony" ? "Sony WH-1000XM6" : undefined) });
    assert.equal(group.meta, "Daily at 06:00");
    assert.deepEqual(
      group.rows.map((r) => [r.label, r.value, r.before]),
      [
        ["Sums up", "GPU deals", undefined],
        ["Sums up", "Sony WH-1000XM6", "New"],
        ["Stops summing up", "Bitcoin under $70,000", undefined],
        ["Sends", "Daily at 06:00", "Daily at 08:00"],
        ["Written by", "AI", "Timely"],
        ["Alerts on", "Desktop", undefined],
      ],
    );
    assert.equal(group.args.kind, "brief");
    // Left out, the sources stay as the brief has them.
    const [kept] = reviewGroups([{ ...step, arguments: { bot: "bot_brief", name: "Daily brief" } }]);
    assert.deepEqual(kept.rows.filter((r) => r.label === "Sums up").map((r) => [r.value, r.before]), [
      ["GPU deals", undefined],
      ["Bitcoin under $70,000", undefined],
    ]);
    assert.deepEqual(kept.args.sources, ["bot_gpu", "bot_btc"]);
  });

  test("a plan of briefs says it reads no page", () => {
    const brief = { tool: "create_bot", arguments: { name: "Morning brief", kind: "brief", sources: ["bot_gpu"] } };
    assert.equal(botPlanHint([brief]), "The brief starts when you approve. It reads only what your bots found, never a page.");
    assert.equal(botPlanHint([{ tool: "update_bot", arguments: { bot: "bot_b", briefTime: "07:00" }, before: { bot: { id: "bot_b", kind: "brief" } } }]), "The change applies when you approve. It reads only what your bots found, never a page.");
    assert.equal(botPlanHint([brief, create([shop])]), "Checks start when you approve. It only reads the page; it never buys or signs in.");
    assert.equal(botPlanHint([{ tool: "update_bot", arguments: { bot: "bot_1" } }]), "The change applies when you approve. It only reads the page; it never buys or signs in.");
  });

  test("Only in the brief shows when the step sets it", () => {
    const before = { id: "bot_gpu", name: "GPU deals", briefOnly: false, intervalMinutes: 30, desktop: true, phone: true, urgent: false, watches: [{ id: "bwt_1", kind: "feed", url: "https://www.reddit.com/r/buildapcsales/.rss", rules: [{ kind: "new_item" }] }] };
    const step = { tool: "update_bot", summary: "", arguments: { bot: "bot_gpu", briefOnly: true }, status: "pending", before };
    const [group] = reviewGroups([step]);
    assert.deepEqual(group.rows.find((r) => r.label === "Only in the brief"), { label: "Only in the brief", value: "On", before: "Off" });
    assert.equal(group.args.briefOnly, true);
    assert.equal(reviewGroups([{ ...step, arguments: { bot: "bot_gpu", name: "GPUs" } }])[0].rows.some((r) => r.label === "Only in the brief"), false);
  });
});

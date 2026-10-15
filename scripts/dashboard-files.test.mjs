import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

const { addPickRow, addToPick, anchorFor, parsePickRanges, pickColumnIndexes, pickRangeText, toggleColumn, computeSheetCard, docBlocks, docChecks, docSections, pickDocBlocks, pickDocChecks, parseRange, formatRange, previewGrid, repick, setPickCell, setPickTarget, suggestSheetPick, toggleDocCheck, usedBox } = await import(
  "../packages/contract/src/dashboardFiles.ts"
);
const { fitQuery, normalizeDashboard, describeQuery, defaultQuery } = await import("../packages/contract/src/dashboard.ts");

const columns = [
  { id: "cat", name: "Category", width: 120, type: "text" },
  { id: "budget", name: "Budget", width: 100, type: "currency", format: { currency: "USD" } },
  { id: "spent", name: "Spent", width: 100, type: "currency", format: { currency: "USD" } },
  { id: "left", name: "Left", width: 100, type: "formula" },
];
const data = [
  ["Rent", "1400", "1400"],
  ["Groceries", "450", "312.4"],
  ["Fun", "150", "64"],
];
const rows = [
  { id: "h", cells: { cat: "Category", budget: "Budget", spent: "Spent", left: "Left" } },
  ...data.map(([cat, budget, spent], i) => ({ id: `r${i}`, cells: { cat, budget, spent, left: `=B${i + 2}-C${i + 2}` } })),
  { id: "total", cells: { cat: "Total", budget: "=SUM(B2:B4)", spent: "=SUM(C2:C4)", left: "=B5-C5" } },
];
const sheet = (extra = {}) => ({
  id: "sht_1",
  title: "October budget",
  icon: null,
  columns,
  rows,
  merges: [],
  tabs: [
    { id: "tab_main", name: "Budget", columns, rows, merges: [] },
    { id: "tab_sum", name: "Summary", columns: [{ id: "x", name: "X", width: 100, type: "number" }], rows: [{ id: "s1", cells: { x: "=Budget!C5*2" } }] },
  ],
  workspaceId: "ws",
  projectId: null,
  userId: "u",
  isFavorite: false,
  archivedAt: null,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
  ...extra,
});

describe("ranges", () => {
  test("read A1 ranges, single cells and open-ended columns", () => {
    assert.deepEqual(parseRange("b7"), { c0: 1, r0: 6, c1: 1, r1: 6 });
    assert.deepEqual(parseRange("C6:A1"), { c0: 0, r0: 0, c1: 2, r1: 5 });
    assert.deepEqual(parseRange("A2:C"), { c0: 0, r0: 1, c1: 2, r1: null });
    assert.equal(parseRange("A0"), null);
    assert.equal(formatRange(parseRange("A2:C")), "A2:C");
    assert.equal(formatRange(parseRange("D4:D4")), "D4");
  });
});

describe("sheet cards", () => {
  test("a value card shows the cell as the sheet does, worked out by its formulas", () => {
    const result = computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "C5", view: "value" });
    assert.equal(result.kind, "value");
    assert.equal(result.number, 1776.4);
    assert.match(result.text, /1,776\.40/);
  });

  test("a value over several cells is their total, named by the header", () => {
    const result = computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "C1:C4", headers: true, view: "value" });
    assert.equal(result.number, 1776.4);
    assert.equal(result.label, "Spent");
  });

  test("a card follows its cells when rows move, and updates when a value changes", () => {
    const pick = { sheetId: "sht_1", tabId: "tab_main", range: "C3", view: "value" };
    pick.anchor = anchorFor(sheet().tabs[0], parseRange("C3"));
    const moved = [rows[0], { id: "new", cells: {} }, ...rows.slice(1)];
    const shifted = sheet({ tabs: [{ ...sheet().tabs[0], rows: moved }, sheet().tabs[1]] });
    assert.equal(computeSheetCard(shifted, pick).number, 312.4);
    const edited = setPickCell(sheet(), "tab_main", "r1", "spent", "$400");
    assert.equal(computeSheetCard(edited.sheet, pick).number, 400);
    // Only the changed tab is sent, with the tab order, like the editors.
    assert.deepEqual(edited.payload.tabOrder, ["tab_main", "tab_sum"]);
    assert.equal(edited.payload.tabs.length, 1);
    assert.equal(setPickCell(sheet(), "tab_main", "total", "spent", "5"), null, "formula cells are not overwritten");
  });

  test("charts read names from one column and values from the rest", () => {
    const result = computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "A1:C4", headers: true, view: "bar" });
    assert.equal(result.kind, "chart");
    assert.deepEqual(result.series.map((entry) => entry.name), ["Budget", "Spent"]);
    assert.deepEqual(result.series[1].points.map((point) => [point.label, point.value]), [["Rent", 1400], ["Groceries", 312.4], ["Fun", 64]]);
  });

  test("progress reads its goal from another cell", () => {
    const result = computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "C5", target: "B5", view: "progress" });
    assert.equal(result.value, 1776.4);
    assert.equal(result.target, 2000);
  });

  test("quick add inserts below the pick, grows the totals and copies formulas down", () => {
    const pick = { sheetId: "sht_1", tabId: "tab_main", range: "A1:D4", headers: true, view: "addRow" };
    const form = computeSheetCard(sheet(), pick);
    assert.deepEqual(form.fields.map((field) => field.name), ["Category", "Budget", "Spent"]);
    const added = addPickRow(sheet(), pick, { cat: "Gifts", budget: "100", spent: "$25.50" });
    const tab = added.sheet.tabs[0];
    assert.equal(tab.rows[4].cells.cat, "Gifts");
    assert.equal(tab.rows[4].cells.spent, "25.5");
    assert.equal(tab.rows[4].cells.left, "=B5-C5");
    assert.equal(tab.rows[5].cells.spent, "=SUM(C2:C5)");
    // Another tab's formula keeps pointing at the total.
    assert.equal(added.sheet.tabs[1].rows[0].cells.x, "=Budget!C6*2");
    assert.equal(computeSheetCard(added.sheet, { sheetId: "sht_1", tabId: "tab_main", range: "C6", view: "value" }).number, 1801.9);
  });

  test("a goal cell follows its cell when a row is added above it", () => {
    const pick = setPickTarget(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "C5", anchor: { fromRow: "total", toRow: "total", fromCol: "spent", toCol: "spent" }, view: "progress" }, "b5");
    assert.deepEqual(pick.targetAnchor, { row: "total", col: "budget" });
    const added = addPickRow(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "A1:C4", headers: true, view: "addRow" }, { cat: "Gifts", budget: "100", spent: "25" });
    const progress = computeSheetCard(added.sheet, pick);
    assert.equal(progress.value, 1801.4);
    assert.equal(progress.target, 2100);
    assert.equal(setPickTarget(sheet(), pick, "2000").targetAnchor, undefined);
  });

  test("quick add over a pick that includes the totals row adds above the totals", () => {
    const pick = { sheetId: "sht_1", tabId: "tab_main", range: "A1:D5", headers: true, view: "addRow" };
    const form = computeSheetCard(sheet(), pick);
    assert.deepEqual(form.fields.map((field) => field.name), ["Category", "Budget", "Spent"]);
    assert.equal(form.afterLabel, "row 4");
    const tab = addPickRow(sheet(), pick, { cat: "Gifts", budget: "100", spent: "25" }).sheet.tabs[0];
    assert.equal(tab.rows[4].cells.cat, "Gifts");
    assert.equal(tab.rows[5].cells.cat, "Total");
    assert.equal(tab.rows[5].cells.budget, "=SUM(B2:B5)");
  });

  test("a table without a names row is headed by the sheet's column names", () => {
    const table = computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "tab_main", range: "A2:C3", view: "table" });
    assert.deepEqual(table.headers, ["Category", "Budget", "Spent"]);
  });

  test("an open-ended pick keeps reading new rows", () => {
    const pick = { sheetId: "sht_1", tabId: "tab_main", range: "A2:C", view: "table" };
    assert.equal(computeSheetCard(sheet(), pick).rows.length, 4);
    const added = addPickRow(sheet(), pick, { cat: "Late" });
    const rows = computeSheetCard(added.sheet, pick).rows;
    assert.equal(rows.length, 5);
    // It lands above the totals, which stay last.
    assert.deepEqual(rows.slice(-2).map((row) => row[0].text), ["Late", "Total"]);
  });

  test("a counter counts from an empty cell", () => {
    const empty = sheet({ tabs: [{ ...sheet().tabs[0], rows: [...rows, { id: "e", cells: {} }] }] });
    const result = computeSheetCard(empty, { sheetId: "sht_1", range: "B6", view: "counter", step: 2 });
    assert.equal(result.value, 0);
    assert.equal(result.step, 2);
  });

  test("a deleted sheet or missing tab says so instead of showing zero", () => {
    assert.equal(computeSheetCard(undefined, { sheetId: "x", range: "A1", view: "value" }).kind, "missing");
    assert.equal(computeSheetCard(sheet(), { sheetId: "sht_1", tabId: "gone", range: "A1", view: "value" }).kind, "missing");
  });

  test("sheets saved before tabs read their only grid", () => {
    const legacy = sheet({ tabs: [] });
    assert.equal(computeSheetCard(legacy, { sheetId: "sht_1", range: "B5", view: "value" }).number, 2000);
    const edited = setPickCell(legacy, undefined, "r0", "cat", "Home");
    assert.equal(edited.payload.rows[1].cells.cat, "Home");
    assert.equal(edited.payload.tabs, undefined);
    // Quick add on such a sheet saves the new row, not only the shifted totals.
    const added = addPickRow(legacy, { sheetId: "sht_1", range: "A1:D5", headers: true, view: "addRow" }, { cat: "Gifts", budget: "100" });
    assert.deepEqual(added.payload.rows.map((row) => row.cells.cat), ["Category", "Rent", "Groceries", "Fun", "Gifts", "Total"]);
    assert.equal(added.payload.rows[5].cells.budget, "=SUM(B2:B5)");
  });
});

describe("picking cells", () => {
  test("a new sheet card starts on the used cells, with names and bars", () => {
    const pick = suggestSheetPick(sheet());
    assert.equal(pick.tabId, "tab_main");
    // The totals row is left out, so it isn't the biggest bar.
    assert.equal(pick.range, "A1:D4");
    assert.equal(pick.headers, true);
    assert.equal(pick.labelCol, 0);
    assert.equal(pick.view, "bar");
    assert.equal(pick.fileTitle, "October budget");
    assert.deepEqual(pick.anchor, { fromRow: "h", toRow: "r2", fromCol: "cat", toCol: "left" });
    assert.equal(computeSheetCard(sheet(), pick).kind, "chart");
  });

  test("one cell starts as a value, an empty tab as A1", () => {
    assert.equal(suggestSheetPick(sheet(), "tab_sum").view, "value");
    assert.equal(suggestSheetPick(sheet(), "tab_sum").range, "A1");
    const empty = sheet({ tabs: [{ id: "t", name: "Empty", columns, rows: [{ id: "e", cells: {} }], merges: [] }] });
    assert.equal(usedBox(empty.tabs[0]), null);
    assert.equal(suggestSheetPick(empty).range, "A1");
  });

  test("dragging new cells moves the range and its anchors; one row drops the names row", () => {
    const pick = repick(sheet(), suggestSheetPick(sheet()), { c0: 2, r0: 4, c1: 2, r1: 4 });
    assert.equal(pick.range, "C5");
    assert.deepEqual(pick.anchor, { fromRow: "total", toRow: "total", fromCol: "spent", toCol: "spent" });
    assert.equal(pick.headers, undefined);
  });

  test("the picker grid shows worked-out values with their addresses", () => {
    const preview = previewGrid(sheet(), "tab_main", 3, 2);
    assert.equal(preview.cols, 4);
    assert.equal(preview.grid[4][3].text, "223.6");
    assert.equal(preview.grid[4][3].address, "D5");
  });
});

describe("columns that are not next to each other", () => {
  const base = { sheetId: "sht_1", tabId: "tab_main", range: "A1:D4", headers: true, labelCol: 0, view: "bar" };

  test("clicking a column letter takes that column out, leaving a gap the chart skips", () => {
    const pick = toggleColumn(sheet(), base, 1);
    assert.equal(pick.range, "A1:D4");
    assert.deepEqual(pick.cols, ["cat", "spent", "left"]);
    assert.equal(pickRangeText(sheet(), pick), "A1:A4, C1:D4");
    const result = computeSheetCard(sheet(), pick);
    assert.deepEqual(result.series.map((series) => series.name), ["Spent", "Left"]);
    assert.deepEqual(result.series[0].points.map((point) => point.label), ["Rent", "Groceries", "Fun"]);
  });

  test("adding a column further along widens the range; a full run drops the column list", () => {
    const narrow = repick(sheet(), base, parseRange("A1:B4"));
    const wide = toggleColumn(sheet(), narrow, 3);
    assert.equal(wide.range, "A1:D4");
    assert.deepEqual(wide.cols, ["cat", "budget", "left"]);
    const table = computeSheetCard(sheet(), { ...wide, view: "table" });
    assert.deepEqual(table.headers, ["Category", "Budget", "Left"]);
    const full = toggleColumn(sheet(), wide, 2);
    assert.equal(full.cols, undefined);
    assert.equal(full.range, "A1:D4");
  });

  test("the last column can't be taken out, and a dragged block clears the gaps", () => {
    const one = { ...base, range: "B1:B4" };
    assert.deepEqual(toggleColumn(sheet(), one, 1), one);
    const gappy = toggleColumn(sheet(), base, 1);
    assert.equal(repick(sheet(), gappy, parseRange("A1:B3")).cols, undefined);
  });

  test("a column letter clicked on a one-cell pick reads the whole used column", () => {
    const pick = toggleColumn(sheet(), { ...base, range: "A2", view: "value" }, 2);
    assert.equal(pick.range, "A1:C5");
    assert.deepEqual(pick.cols, ["cat", "spent"]);
  });

  test("the picked columns follow a column moved in between", () => {
    const pick = toggleColumn(sheet(), base, 1);
    const moved = [columns[0], columns[1], { id: "new", name: "Note", width: 80, type: "text" }, columns[2], columns[3]];
    const tab = { id: "tab_main", name: "Budget", columns: moved, rows, merges: [] };
    const next = sheet({ tabs: [tab], columns: moved });
    assert.deepEqual(pickColumnIndexes(next, pick), [0, 3, 4]);
    assert.equal(pickRangeText(next, pick), "A1:A4, D1:E4");
  });

  test("ctrl/cmd+click adds a cell's column, growing the rows; again takes it out", () => {
    const pick = repick(sheet(), base, parseRange("A1:A3"));
    const added = addToPick(sheet(), pick, parseRange("C4"));
    assert.equal(added.range, "A1:C4");
    assert.deepEqual(added.cols, ["cat", "spent"]);
    const removed = addToPick(sheet(), added, parseRange("C2"));
    assert.equal(removed.range, "A1:A4");
    assert.equal(removed.cols, undefined);
    const dragged = addToPick(sheet(), pick, parseRange("C1:D2"));
    assert.equal(pickRangeText(sheet(), dragged), "A1:A3, C1:D3");
  });

  test("typed ranges with commas pick their columns over the shared rows", () => {
    assert.deepEqual(parsePickRanges("A1:A8, C1:D8"), { columns: [0, 2, 3], rows: { r0: 0, r1: 7 } });
    assert.deepEqual(parsePickRanges("B2:B"), { columns: [1], rows: { r0: 1, r1: null } });
    assert.equal(parsePickRanges("A1, nope"), null);
  });
});

describe("doc cards", () => {
  const content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Packing" }] },
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Passport" }] }] },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Adapter" }] },
              { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "USB-C" }] }] }] },
            ],
          },
        ],
      },
      { type: "codeBlock", content: [{ type: "text", text: "- [ ] not a task" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] }] },
    ],
  };

  test("checklists list every checkbox in order, nested ones too", () => {
    assert.deepEqual(
      docChecks(content).map((item) => [item.index, item.text, item.checked, item.depth]),
      [
        [0, "Passport", true, 0],
        [1, "Adapter", false, 0],
        [2, "USB-C", false, 1],
      ],
    );
  });

  test("ticking an item changes only that item", () => {
    const next = toggleDocCheck(content, 2, true);
    assert.deepEqual(docChecks(next).map((item) => item.checked), [true, false, true]);
    assert.deepEqual(docChecks(content).map((item) => item.checked), [true, false, false], "the original is untouched");
    assert.equal(next.content[0], content.content[0], "untouched blocks are shared");
  });

  test("the page view keeps headings, bullets and checkboxes with their index", () => {
    const blocks = docBlocks(content);
    assert.deepEqual(blocks.map((block) => block.kind), ["heading", "check", "check", "check", "code", "bullet"]);
    assert.equal(blocks[3].index, 2);
  });
});

describe("doc sections", () => {
  const t = (text) => ({ type: "text", text });
  const p = (text) => ({ type: "paragraph", content: [t(text)] });
  const h = (level, text) => ({ type: "heading", attrs: { level }, content: [t(text)] });
  const item = (text, checked) => ({ type: "taskItem", attrs: { checked }, content: [p(text)] });
  const doc = {
    type: "doc",
    content: [
      h(1, "Trip"),
      { type: "blockquote", content: [{ type: "taskList", content: [item("Quoted", false)] }] },
      h(2, "Packing"),
      { type: "taskList", content: [item("Passport", true), item("Jacket", false)] },
      h(2, "Food"),
      p("Ramen"),
      { type: "taskList", content: [item("Book Kikunoi", false)] },
    ],
  };

  test("headings list the checkboxes under them", () => {
    assert.deepEqual(
      docSections(doc).map((section) => [section.text, section.checks, section.done]),
      [["Trip", 3, 1], ["Packing", 2, 1], ["Food", 1, 0]],
    );
  });

  test("a section checklist keeps the doc's own numbering, past a quoted checkbox", () => {
    const { checks, found } = pickDocChecks(doc, { section: "Food" });
    assert.equal(found, true);
    assert.deepEqual(checks.map((check) => [check.index, check.text]), [[3, "Book Kikunoi"]]);
    assert.equal(docBlocks(doc).find((block) => block.kind === "check" && block.text === "Book Kikunoi").index, 3);
  });

  test("a section page stops at the next heading, and a lost heading falls back to the whole doc", () => {
    assert.deepEqual(pickDocBlocks(doc, { section: "Packing" }).blocks.map((block) => block.text), ["Passport", "Jacket"]);
    const lost = pickDocBlocks(doc, { section: "Gone" });
    assert.equal(lost.found, false);
    assert.equal(lost.blocks[0].text, "Trip");
  });
});

describe("file cards in a layout", () => {
  test("a sheet pick survives normalising and keeps a plain display for older apps", () => {
    const layout = normalizeDashboard({
      version: 1,
      cards: [{ id: "a", type: "custom", w: 3, h: 2, query: { ...defaultQuery("sheets"), sheet: { sheetId: "sht_1", range: "c5", view: "counter", fileTitle: "Habit log" } } }],
    });
    const query = layout.cards[0].query;
    assert.equal(query.sheet.range, "C5");
    assert.equal(query.display, "number");
    assert.equal(describeQuery(query), "Counter · Habit log");
    assert.equal(layout.cards[0].w, 3);
  });

  test("a pick only lives on its own source", () => {
    const query = fitQuery({ ...defaultQuery("tasks"), sheet: { sheetId: "s", range: "A1", view: "value" } });
    assert.equal(query.sheet, undefined);
    const doc = fitQuery({ ...defaultQuery("docs"), doc: { docId: "doc_1", view: "checklist" } });
    assert.equal(doc.display, "list");
    assert.equal(doc.doc.view, "checklist");
  });
});

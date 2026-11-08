import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { checklistItems } from "../packages/contract/src/docChecklist.ts";
import { blockProblems, boardExamples, cellsProblems, drawBoard, drawProblems } from "../packages/contract/src/genuiBoard.ts";
import { escapeHtml, liveBlockHtml } from "../apps/mobile/components/editor/liveBlockHtml.ts";

// The phone draws a doc's live blocks as HTML for its editor page; these
// check that markup against the shared programs and data.
const ctx = { now: new Date("2026-10-28T12:00:00Z"), timeZone: "UTC" };
const projects = [{ id: "p1", title: "Client work", workspaceId: "ws1" }];
const task = (id, name, extra = {}) => ({
  id, name, kind: "work", projectId: "p1", project: projects[0], workspaceId: "ws1", deadline: null, completedAt: null,
  createdAt: "2026-10-01", updatedAt: "2026-10-01T09:00:00Z", duration: 30, actualMinutes: 0, labels: [], blocks: [], ...extra,
});
const data = {
  workspaces: [{ id: "ws1", name: "Work", status: [] }],
  projects,
  tasks: [
    task("t1", "Send <b>invoice</b>", { deadline: "2026-10-26" }),
    task("t2", "Review proposal", { deadline: "2026-10-30" }),
    task("t3", "Ship release", { completedAt: "2026-10-27T15:00:00Z", actualMinutes: 90 }),
  ],
};
const lookup = {
  task: (id) => {
    const found = data.tasks.find((entry) => entry.id === id);
    return found && { title: found.name, done: Boolean(found.completedAt), late: id === "t1" };
  },
  checklist: () => undefined,
};
const draw = (program) => liveBlockHtml(drawBoard(program, data, ctx), lookup);

describe("phone live block HTML", () => {
  test("every example program draws", () => {
    for (const { program } of boardExamples()) {
      const html = draw(program);
      assert.match(html, /^<div class="lv-panel">/, program);
      assert.ok(!html.includes("[object Object]"), program);
      assert.ok(!html.includes("undefined"), program);
    }
  });

  test("task rows tick, open and show their live state", () => {
    const html = draw(`root = Panel("Client work", [list])
list = List(@Each(@Data({source: "tasks", project: "Client work", state: "all", sort: "deadline"}).rows, "row", TaskRow(row.id, row.title, row.day, row.note)), "Nothing here")`);
    assert.match(html, /data-live-tick="t1" data-done="0"/);
    assert.match(html, /data-live-open="timely:\/\/task\/t1"/);
    // A late task's row is marked; a done one is struck through and says so.
    assert.match(html, /<div class="lv-row is-warning">/);
    assert.match(html, /class="lv-check is-done" role="checkbox" aria-checked="true"/);
    assert.match(html, /<span class="lv-title is-done">Ship release<\/span>/);
    assert.match(html, /<span class="lv-meta">Done<\/span>/);
  });

  test("a sheet's cells draw as a chart and rows, money short over the bars, cell text escaped", () => {
    const column = (id, name, type = "text") => ({ id, name, type, width: 120 });
    const tab = {
      id: "t",
      name: "October",
      columns: [column("c", "Category"), column("a", "Amount", "number")],
      rows: [{ id: "1", cells: { c: "Rent", a: "25000" } }, { id: "2", cells: { c: "Food <i>", a: "1250" } }, { id: "3", cells: { c: "Bus", a: "300" } }],
    };
    const sheets = [{ id: "sh1", title: "Budget", tabs: [tab], columns: tab.columns, rows: tab.rows, merges: [], workspaceId: "ws1", updatedAt: "2026-10-20" }];
    const html = liveBlockHtml(
      drawBoard(
        `root = Panel("Spending", [chart, list])
spend = @Cells({sheet: "Budget", label: "Category", value: "Amount", sort: "value"})
chart = BarChart("Per category", spend.labels, spend.values)
list = List(@Each(spend.rows, "r", ShareRow(r.label, r.text, r.share)), "No spending", Open("Open Budget", "sheet", spend.sheetId))`,
        { ...data, sheets },
        ctx,
      ),
      lookup,
    );
    assert.deepEqual([...html.matchAll(/<span class="lv-bar-text">([^<]*)<\/span>/g)].map((match) => match[1]), ["25k", "1.3k", "300"]);
    assert.match(html, /aria-label="Rent: 25000"/);
    assert.match(html, /Food &lt;i&gt;/);
    assert.ok(!html.includes("<i>"));
    assert.match(html, /data-live-open="timely:\/\/sheet\/sh1"/);

    // A column renamed after the block was built: a note says which, and the empty chart is left out.
    const renamed = `root = Panel("Spending", [chart, list])
spend = @Cells({sheet: "Budget", label: "Category", value: "Price"})
chart = BarChart("Per category", spend.labels, spend.values)
list = List(@Each(spend.rows, "r", ShareRow(r.label, r.text, r.share)), "No spending")`;
    const lost = liveBlockHtml(drawBoard(renamed, { ...data, sheets }, ctx), lookup, cellsProblems(renamed, { ...data, sheets })[0]);
    assert.match(lost, /^<p class="lv-problem" role="status"><svg[^>]*>.*<\/svg><span>“Budget” has no column called “Price”\.<\/span><\/p>/);
    assert.ok(!lost.includes("lv-chart"), "no empty chart frame");
    assert.equal([...lost.matchAll(/class="lv-sec"/g)].length, 1, "only the list's section");
    assert.match(lost, /No spending/);
  });

  test("text from the data or the program is escaped", () => {
    const html = draw(`root = Panel("A <script>", [list, note])
list = List(@Each(@Data({source: "tasks", project: "Client work"}).rows, "row", TaskRow(row.id, row.title)))
note = Text("<img src=x onerror=alert(1)>")`);
    assert.ok(!/<b>|<script|<img/.test(html), html);
    assert.match(html, /Send &lt;b&gt;invoice&lt;\/b&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
  });

  test("a task the app doesn't know can't be ticked", () => {
    const html = liveBlockHtml(drawBoard(`root = Panel("x", [List([TaskRow("gone", "Old task")])])`, data, ctx), { task: () => undefined, checklist: () => undefined });
    assert.match(html, /<button type="button" class="lv-check" role="checkbox" aria-checked="false" aria-label="Complete Old task" disabled>/);
    assert.ok(!html.includes("data-live-open"));
  });

  test("a doc's checklist items tick in that doc and open it", () => {
    const item = (text, checked = false) => ({
      type: "taskItem",
      attrs: { checked },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Groceries" }] },
        { type: "taskList", content: [item("Onion"), item("Milk", true), item("Bread & <jam>")] },
      ],
    };
    const docs = [{ id: "doc_1", title: "Shopping list", content, workspaceId: "ws1", updatedAt: "2026-10-29T09:00:00Z" }];
    const live = { ...lookup, checklist: (id) => (id === "doc_1" ? checklistItems(content) : undefined) };
    const program = `root = Panel("Shopping", [list])
shop = @Checklist({doc: "Shopping list", state: "all"})
list = List(@Each(shop.rows, "i", CheckRow(i.docId, i.text, i.note, i.item)), "", Open("Open doc", "doc", shop.docId))`;
    const html = liveBlockHtml(drawBoard(program, { ...data, docs }, ctx), live, blockProblems(program, { ...data, docs })[0]);
    assert.match(html, /data-live-check="doc_1" data-item="0" data-text="Onion" data-done="0"/);
    assert.match(html, /class="lv-check is-done" role="checkbox" aria-checked="true" aria-label="Untick Milk" data-live-check="doc_1" data-item="1"/);
    assert.match(html, /<span class="lv-title is-done">Milk<\/span>/);
    assert.match(html, /data-text="Bread &amp; &lt;jam&gt;"/);
    assert.match(html, /<span class="lv-meta">Groceries<\/span>/);
    assert.match(html, /data-live-open="timely:\/\/doc\/doc_1"><span class="lv-title">Onion/);
    assert.match(html, /data-live-open="timely:\/\/doc\/doc_1">Open doc/);
    assert.ok(!html.includes("lv-problem"));

    // A doc the app doesn't have: the item shows but can't be ticked or opened.
    const gone = liveBlockHtml(drawBoard(`root = Panel("x", [List([CheckRow("doc_9", "Eggs")])])`, data, ctx), lookup);
    assert.match(gone, /aria-label="Tick Eggs" disabled>/);
    assert.ok(!gone.includes("data-live-open"));
  });

  test("stats, charts, shares, a day strip, columns and links", () => {
    const html = draw(`root = Panel("Week", [nums, chart, shares, day, cols, Text("Notes")])
nums = Stats([Stat("Done", "18/22"), Stat("On time", "82%"), Stat("Focus", "9h"), Stat("Late", "2")])
chart = BarChart("Focus by day", ["Mon", "Tue", "Wed"], [2, 5, 3], "h")
shares = Card("Projects", [ShareRow("Client work", "5 h", 100, "indigo"), InfoRow("Late", "2", "This week", "warning"), EventRow("10:00", "Gym", "1 h", "teal")], "3", Open("Open Today", "today"))
day = DayStrip("08:00", "20:00", [Slot("09:00", "10:30", "event", "Standup", "teal"), Slot("13:00", "15:00", "free")])
cols = Columns([Card("Left", [InfoRow("A")]), Card("Right", [InfoRow("B")], null, Open("Open doc", "doc", "doc_1"))])`);
    // Four stats sit two by two, the second row bordered on top.
    assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(html, /<div class="lv-stat-value">18<span class="lv-stat-total">\/22<\/span><\/div>/);
    assert.match(html, /<div class="lv-stat is-top">/);
    // The tallest bar stands out; bars carry their value for screen readers.
    assert.match(html, /aria-label="Tue: 5 h"><span class="lv-bar-text">5<\/span><span class="lv-bar is-high" style="height:64px">/);
    assert.match(html, /<span style="width:100%;background:#[0-9a-f]{6}">/i);
    assert.match(html, /<div class="lv-row is-warning"><span class="lv-body"><span class="lv-line"><span class="lv-title lv-label">Late<\/span><span class="lv-value">2<\/span>/);
    assert.match(html, /<span class="lv-event-bar" style="background:#[0-9a-f]{6}">/i);
    assert.match(html, /class="lv-slot" style="left:8\.33/);
    assert.match(html, /class="lv-slot is-free"/);
    assert.match(html, /<span class="is-start" style="left:0%">08<\/span>/);
    assert.match(html, /<span class="is-end" style="left:100%">20<\/span>/);
    // In Columns a card's title is a heading, not an eyebrow.
    assert.match(html, /<span class="lv-head-title">Left<\/span>/);
    assert.match(html, /<span class="lv-eyebrow">PROJECTS<\/span><span class="lv-head-meta">3<\/span>/);
    assert.match(html, /data-live-open="\/today">Open Today/);
    assert.match(html, /data-live-open="timely:\/\/doc\/doc_1">Open doc/);
    assert.match(html, /<p class="lv-text">Notes<\/p>/);
  });

  test("an empty list says so", () => {
    const html = draw(`root = Panel("x", [List(@Each(@Data({source: "tasks", project: "Garden"}).rows, "row", TaskRow(row.id, row.title)), "Nothing overdue")])`);
    assert.match(html, /<p class="lv-empty">Nothing overdue<\/p>/);
  });

  test("a program that can't be drawn gives no HTML", () => {
    assert.equal(liveBlockHtml(null, lookup), "");
  });
});

describe("phone live block HTML: a bot's price history", () => {
  const rule = { id: "brl_below", kind: "below", threshold: 25000, stepPercent: 5, resetPercent: 0.5 };
  const watch = (over = {}) => ({
    id: "bwt_sony", kind: "page", url: "https://www.amazon.in/dp/B0", read: "product_price", selector: "", source: "", symbol: "",
    currency: "INR", readingCurrency: "INR", rules: [rule], health: { code: "working", line: "" }, lastReadingAt: "2026-10-28T11:00:00Z",
    summary: "₹27,499", site: "amazon.in", title: "Sony WH-1000XM6", value: 27499, excerpt: "", latestItem: null, lastChangedAt: null,
    spark: null, dayChangePct: null, ...over,
  });
  const day = (date, close, low = null) => ({ watchId: "bwt_sony", day: date, currency: "INR", points: null, open: close, high: close, low, close });
  const detail = (over = {}) => ({
    id: "bot_sony", name: "Sony \"Pro\" <b>", description: "", status: "active", kind: "watch", health: { code: "working", line: "" }, watches: [watch()],
    prices: [day("2026-10-01", 29990), day("2026-10-10", 26990, 24990), day("2026-10-20", 27990), day("2026-10-27", 27499)],
    checks: [], alerts: [], lessons: [], week: { checks: 0, alerts: 0 }, alertsMonth: 0, rearms: [], links: [], away: null, ...over,
  });
  const block = (bot, watchId) => `root = Panel("Sony", [chart])\nchart = PriceHistory(${JSON.stringify(bot)}${watchId ? `, ${JSON.stringify(watchId)}` : ""})`;
  const asked = [];
  const live = (state, chartWidth = 300) => ({
    ...lookup,
    chartWidth,
    bot: (id) => {
      asked.push(id);
      return state;
    },
  });
  // As LiveBlocks draws it: the note over the block is drawProblems' first.
  const drawn = (program, state, chartWidth) => liveBlockHtml(drawBoard(program, {}, ctx), live(state, chartWidth), drawProblems(program, {})[0]);

  test("a price watch draws as the bot sheet's card: price, low, change, an SVG at the given width and Open bot", () => {
    const html = drawn(block("bot_sony"), { state: "ok", detail: detail() }, 330);
    assert.match(html, /<span class="lv-price-value">₹27,499<\/span><span class="lv-price-lowest">30-day low ₹24,990<\/span>/);
    assert.match(html, /<p class="lv-price-under">₹2,499 above your line · <span class="lv-price-change is-good">/);
    assert.match(html, /<svg width="330" height="130" viewBox="0 0 330 130" class="lv-price-chart" role="img" aria-label="Price over the last/);
    // The rule's line is dashed in the warning colour, labelled in the warning text colour; the price line is the chart colour.
    assert.match(html, /<line class="lv-price-threshold" x1="40" x2="322\.0"/);
    assert.match(html, /<text class="lv-price-threshold-label" [^>]*>Your line ₹25,000<\/text>/);
    assert.match(html, /<path class="lv-price-line" d="M40\.0 /);
    assert.match(html, />Today<\/text>/);
    // Open bot sits in the block's foot and opens the bot by id.
    assert.match(html, /<div class="lv-foot"><button type="button" class="lv-open" data-live-open="timely:\/\/bot\/bot_sony" aria-label="Open bot: Sony &quot;Pro&quot; &lt;b&gt;">Open bot<svg/);
    assert.ok(!html.includes("<b>"), "the bot's name is escaped");
    assert.ok(!html.includes("lv-problem"));
    assert.ok(!html.includes("undefined") && !html.includes("NaN"), html);
    const wide = drawn(block("bot_sony"), { state: "ok", detail: detail() }, 600);
    assert.match(wide, /<svg width="600" height="130" viewBox="0 0 600 130"/);
  });

  test("two price watches name the one drawn; a paused bot says so; a picked watch is drawn", () => {
    const second = watch({ id: "bwt_flip", site: "flipkart.com", value: 26000, rules: [] });
    const two = detail({ status: "paused", watches: [watch(), second] });
    const first = drawn(block("bot_sony"), { state: "ok", detail: two });
    assert.match(first, /<p class="lv-price-meta">amazon\.in · Paused<\/p>/);
    const picked = drawn(block("bot_sony", "bwt_flip"), { state: "ok", detail: two });
    assert.match(picked, /<p class="lv-price-meta">flipkart\.com · Paused<\/p>/);
    assert.match(picked, /<span class="lv-price-value">₹26,000<\/span>/);
    // Under two points the chart says it fills in later.
    const fresh = drawn(block("bot_sony"), { state: "ok", detail: detail({ prices: [] }) });
    assert.match(fresh, /<p class="lv-price-empty">The line fills in after a few days of checks<\/p>/);
  });

  test("a deleted bot, a failed read and a bot without a price say so", () => {
    const gone = drawn(block("bot_sony"), { state: "gone" });
    assert.match(gone, /Bot deleted<\/span><span>Its price history went with it\.<\/span>/);
    assert.ok(!gone.includes("data-live-open"));
    assert.match(drawn(block("bot_sony"), { state: "failed" }), /Couldn’t load this bot’s prices/);
    const page = detail({ watches: [watch({ read: "text", value: null })] });
    assert.match(drawn(block("bot_sony"), { state: "ok", detail: page }), /This bot doesn’t watch a price/);
  });

  test("a name, a reserved word or a quoted id draws the failed words and is never looked up", () => {
    asked.length = 0;
    for (const bad of ["Sony WH-1000XM6", "keys", 'bot_so"ny', '"bot_sony"']) {
      const html = drawn(block(bad), { state: "ok", detail: detail() });
      assert.match(html, /Couldn’t load this bot’s prices/, bad);
      assert.ok(!html.includes("data-live-open"), bad);
      assert.ok(!html.includes("lv-problem"), `one message, no note over it: ${bad}`);
      assert.ok(!html.includes('so"ny') && !html.includes('"bot_sony"'), `escaped: ${bad}`);
    }
    assert.deepEqual(asked, [], "no bot was asked for");
  });

  test("while the bot loads the block draws nothing", () => {
    const html = drawn(block("bot_sony"), { state: "loading" });
    assert.equal(html, '<div class="lv-panel"><div class="lv-sec"></div></div>');
    // An app that hands no bots at all draws nothing for the block either.
    assert.equal(liveBlockHtml(drawBoard(block("bot_sony"), {}, ctx), lookup), '<div class="lv-panel"><div class="lv-sec"></div></div>');
  });
});


test("a doc printed to PDF drops a live block's footer link and keeps its link colour dark", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../apps/mobile/components/editor/editorHtml.ts", import.meta.url), "utf8");
  const exportFn = src.slice(src.indexOf("function exportHtml("), src.indexOf('send({ type: "exportHtml"'));
  assert.match(exportFn, /querySelectorAll\("[^"]*\.live-wrap \.lv-foot[^"]*"\)\.forEach\(\(el\) => el\.remove\(\)\)/);
  assert.match(exportFn, /\.live-wrap \{[^}]*--lv-primary: #3730a3/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { genuiParser, genuiPrompt, replyBlocks, replyText, splitReply } from "../packages/contract/src/genui.ts";

const prompt = genuiPrompt();

describe("reply card prompt", () => {
  test("the API's copy is up to date (make gen-genui-prompt)", () => {
    const file = new URL("../apps/api/internal/features/chat/genui_prompt.txt", import.meta.url);
    assert.equal(readFileSync(file, "utf8"), `${prompt}\n`);
  });

  test("lists the reply components and stays small", () => {
    for (const name of ["Reply(", "Card(", "TaskRow(", "Stats(", "Choices(", "Open("]) assert.ok(prompt.includes(name), name);
    // Replies are grouped cards; side-by-side layouts stay on the dashboard.
    for (const name of ["Columns(", "DayStrip("]) assert.ok(!prompt.includes(name), name);
    // About four characters a token: keep the addition to every run near 2.5k tokens.
    assert.ok(prompt.length < 10000, `prompt is ${prompt.length} characters`);
  });

  test("its examples parse with no errors", () => {
    const programs = splitReply(prompt).filter((part) => part.kind === "ui");
    assert.equal(programs.length, 3);
    for (const { code } of programs) {
      const result = genuiParser().parse(code);
      assert.deepEqual(result.meta.errors, [], code);
      assert.equal(result.root?.typeName, "Reply");
      assert.deepEqual(result.meta.orphaned, []);
    }
  });
});

describe("splitReply", () => {
  const reply = 'Here is today.\n\n```openui-lang\nroot = Reply([c])\nc = Card("Today", [])\n```\n\nAnything else?';

  test("splits text and programs in order", () => {
    assert.deepEqual(splitReply(reply), [
      { kind: "text", text: "Here is today." },
      { kind: "ui", code: 'root = Reply([c])\nc = Card("Today", [])', closed: true },
      { kind: "text", text: "Anything else?" },
    ]);
  });

  test("keeps a cut-off program, marked open", () => {
    const parts = splitReply('Today:\n```openui-lang\nroot = Reply([c])\nc = Card("To');
    assert.equal(parts.length, 2);
    assert.equal(parts[1].kind, "ui");
    assert.equal(parts[1].closed, false);
  });

  test("leaves other code fences in the text", () => {
    const text = "Use this:\n```js\nconsole.log(1)\n```";
    assert.deepEqual(splitReply(text), [{ kind: "text", text }]);
  });

  test("replyText drops the programs", () => {
    assert.equal(replyText(reply), "Here is today.\n\nAnything else?");
    assert.equal(replyText("Plain answer"), "Plain answer");
  });
});

describe("parser", () => {
  test("a cut-off card is left out rather than drawn as an empty frame", () => {
    const cut = genuiParser().parse('root = Reply([a, b])\na = Card("Today", [r])\nr = TaskRow("tsk_1", "Plan")\nb = Card("Broken", [x, y]');
    assert.deepEqual(replyBlocks(cut.root.props.blocks).map((block) => block.props.title), ["Today"]);
    const linked = genuiParser().parse('root = Reply([c])\nc = Card("Tasks", [], "0", open)\nopen = Open("Open Tasks", "tasks")');
    assert.equal(replyBlocks(linked.root.props.blocks).length, 1, "an empty card with a link still shows");
  });

  test("flags components outside the list", () => {
    const result = genuiParser().parse('root = Reply([x])\nx = Script("alert(1)")');
    assert.ok(result.meta.errors.some((e) => e.code === "unknown-component"));
  });
});

describe("described cards", async () => {
  const { boardExamples, boardParser, boardPrompt, describedCard, drawBoard, liveBlockCards, LIVE_BLOCK_LANGUAGE, runData } = await import("../packages/contract/src/genuiBoard.ts");
  const { sourcesUsed } = await import("../packages/contract/src/dashboard.ts");
  const { normalizeDashboard } = await import("../packages/contract/src/dashboard.ts");
  const board = boardPrompt();
  const now = new Date("2026-10-28T12:00:00Z"); // a Wednesday
  const ctx = { now, timeZone: "UTC" };
  const status = { id: "st1", name: "To do" };
  const workspaces = [{ id: "ws1", name: "Work", status: [status], lables: [{ id: "lb1", name: "Deep work" }] }];
  const projects = [
    { id: "p1", title: "Client work", workspaceId: "ws1" },
    { id: "p2", title: "Timely", workspaceId: "ws1" },
  ];
  const task = (id, name, project, extra = {}) => ({
    id, name, kind: "work", projectId: project, project: projects.find((p) => p.id === project), workspaceId: "ws1",
    statusId: "st1", deadline: null, completedAt: null, createdAt: "2026-10-01", updatedAt: "2026-10-01T09:00:00Z",
    duration: 30, actualMinutes: 0, labels: [], blocks: [], ...extra,
  });
  const data = {
    workspaces,
    projects,
    tasks: [
      task("t1", "Send invoice", "p1", { deadline: "2026-10-26" }),
      task("t2", "Review proposal", "p1", { deadline: "2026-10-30" }),
      task("t3", "Fix sync", "p2", { deadline: "2026-10-27" }),
      task("t4", "Ship release", "p2", { completedAt: "2026-10-27T15:00:00Z", actualMinutes: 90 }),
      task("t5", "Weekly review", "p1", { completedAt: "2026-10-21T15:00:00Z", actualMinutes: 30 }),
    ],
  };

  test("the API's copy is up to date (make gen-genui-prompt)", () => {
    const file = new URL("../apps/api/internal/features/provider/board_prompt.txt", import.meta.url);
    assert.equal(readFileSync(file, "utf8"), `${board}\n`);
  });

  test("lists the board components and @Data, and stays small", () => {
    for (const name of ["Panel(", "List(", "Stats(", "TaskRow(", "@Data(", "@Each("]) assert.ok(board.includes(name), name);
    assert.ok(!board.includes("Choices("), "no chat-only components");
    // @Cells made it longer; still near 3.5k tokens a card.
    assert.ok(board.length < 14500, `prompt is ${board.length} characters`);
  });

  test("its examples parse with no errors", () => {
    const examples = boardExamples();
    assert.equal(examples.length, 5);
    for (const { program } of examples) {
      const result = boardParser().parse(program);
      assert.deepEqual(result.meta.errors, [], program);
      assert.equal(result.root?.typeName, "Panel");
      assert.deepEqual(result.meta.orphaned, []);
    }
  });

  test("@Data counts, lists and splits by name, live from the data", () => {
    const late = runData({ source: "tasks", project: "client work", overdue: true }, data, ctx);
    assert.equal(late.value, 1);
    assert.equal(late.text, "1");
    assert.deepEqual(late.rows.map((row) => [row.id, row.day, row.late]), [["t1", "26 Oct", true]]);

    const open = runData({ source: "tasks", by: "project", sort: "deadline" }, data, ctx);
    assert.deepEqual(open.rows.map((row) => row.day), ["26 Oct", "27 Oct", "Fri"]);
    assert.deepEqual(open.labels, ["Client work", "Timely"]);
    assert.deepEqual(open.groups.map((group) => group.share), [100, 50]);

    const week = runData({ source: "tasks", state: "done", range: "thisWeek", by: "day", measure: "tracked" }, data, ctx);
    assert.equal(week.text, "1.5h");
    assert.equal(week.labels[0], "Mon");
    assert.match(week.change, /^\+1h vs the week before$/);

    const due = runData({ source: "tasks", date: "deadline", range: "thisWeek", state: "all" }, data, ctx);
    assert.equal(due.ratio, "0/3");
  });

  test("a name that matches nothing finds nothing rather than everything", () => {
    assert.equal(runData({ source: "tasks", project: "Garden" }, data, ctx).value, 0);
  });

  test("a described card keeps its program and saves a plain card for older apps", () => {
    const { words, program } = boardExamples()[0];
    const card = describedCard("c1", words, program, data);
    assert.equal(card.title, "Client work");
    assert.deepEqual([card.w, card.h], [4, 3]);
    assert.equal(card.type, "custom");
    assert.equal(card.query.display, "list");
    assert.deepEqual(card.query.filters.projectIds, ["p1"]);
    assert.equal(card.query.described.program, program);
    const saved = normalizeDashboard({ version: 1, cards: [card] });
    assert.equal(saved.cards[0].query.described.program, program);
    const broken = normalizeDashboard({ version: 1, cards: [{ ...card, query: { ...card.query, described: { program: 42 } } }] });
    assert.equal(broken.cards[0].query.described, undefined);
    assert.equal(describedCard("c2", "x", 'root = Reply([])'), null);
  });

  test("drawBoard works out every prop the phone draws", () => {
    const leaves = (node, out = []) => {
      if (Array.isArray(node)) node.forEach((item) => leaves(item, out));
      else if (node?.type === "element") Object.values(node.props).forEach((value) => leaves(value, out));
      else if (node && typeof node === "object") out.push(node);
      return out;
    };
    for (const { program } of boardExamples()) {
      const root = drawBoard(program, data, ctx);
      assert.equal(root?.typeName, "Panel", program);
      assert.deepEqual(leaves(root), [], `unevaluated props in ${program}`);
    }
    const [stats, list] = drawBoard(boardExamples()[0].program, data, ctx).props.blocks;
    assert.deepEqual(stats.props.items.map((stat) => stat.props.value), ["1", "0/2"]);
    assert.deepEqual(list.props.rows.map((row) => [row.typeName, row.props.title]), [["TaskRow", "Send invoice"]]);
    assert.equal(drawBoard('root = Reply([])', data, ctx), null);
  });

  test("live blocks are the same programs in an openui-lang fence, loading only what they read", () => {
    // The fence language is the one reply cards use, so Markdown and the agent see one kind of block.
    assert.equal(LIVE_BLOCK_LANGUAGE, "openui-lang");
    const events = 'root = Panel("Today", [List(@Each(@Data({source: "events"}).rows, "e", EventRow(e.time, e.title)))])';
    const cards = liveBlockCards([boardExamples()[0].program, "  ", events]);
    assert.deepEqual(cards.map((card) => card.id), ["live-0", "live-1"]);
    assert.equal(cards[1].query.described.program, events);
    const used = sourcesUsed(cards);
    assert.ok(used.has("tasks") && used.has("events"), [...used].join());
    assert.ok(!used.has("sheets"));
    assert.deepEqual(liveBlockCards([]), []);
  });
});

describe("@Cells: a sheet's cells in described cards and live blocks", async () => {
  const { boardExamples, cellsProblems, DESCRIBE_CHANGES, describeChanges, describeExamples, DESCRIBE_EXAMPLES, drawBoard, liveBlockCards, runCells } = await import("../packages/contract/src/genuiBoard.ts");
  const { describedSources, sourcesUsed } = await import("../packages/contract/src/dashboard.ts");
  const ctx = { now: new Date("2026-10-28T12:00:00Z"), timeZone: "UTC" };
  // Currency puts a no-break space after the symbol.
  const money = (text) => text.replace(/\u00a0/g, " ");
  const column = (id, name, type = "text", extra = {}) => ({ id, name, type, width: 120, ...extra });
  const row = (id, cells) => ({ id, cells });
  // The built-in expenses layout: named columns, the month's totals on top, per-row formulas.
  const october = {
    id: "tab_oct",
    name: "October",
    columns: [column("d", "Date", "date"), column("c", "Category"), column("a", "Amount", "currency", { format: { currency: "LKR" } }), column("p", "Paid"), column("q", "Qty", "number"), column("t", "Total", "formula")],
    rows: [
      row("top", { c: '="Month total · "&COUNTA(C2:C)', t: "=SUM(F2:F)" }),
      row("r1", { d: "2026-10-01", c: "Groceries", a: "1200", p: "yes", q: "2", t: "=IF(C2=\"\",\"\",C2*E2)" }),
      row("r2", { d: "2026-10-03", c: "Transport", a: "3000", p: "", q: "1", t: "=IF(C3=\"\",\"\",C3*E3)" }),
      row("r3", { d: "2026-10-04", c: "groceries", a: "800", p: "yes", q: "1", t: "=IF(C4=\"\",\"\",C4*E4)" }),
      row("r4", { d: "2026-10-09", c: "Rent", a: "25000", p: "yes", q: "1", t: "=IF(C5=\"\",\"\",C5*E5)" }),
      row("r5", {}),
    ],
  };
  const notes = { id: "tab_notes", name: "Notes", columns: [column("n", "A")], rows: [row("n1", { n: "" })] };
  // Letters over the columns, the names typed in row 1, a totals row at the bottom.
  const runs = {
    id: "tab_runs",
    name: "Week",
    columns: [column("x", "A"), column("y", "B"), column("z", "C")],
    rows: [row("h", { x: "Day", y: "Km", z: "Feel" }), row("1", { x: "Mon", y: "5", z: "Good" }), row("2", { x: "Tue", y: "7.5", z: "Tired" }), row("3", { x: "Wed", y: "3", z: "Good" }), row("4", { y: "=SUM(B2:B4)" })],
  };
  const sheet = (id, title, tabs, extra = {}) => ({ id, title, tabs, columns: tabs[0].columns, rows: tabs[0].rows, merges: [], workspaceId: "ws1", updatedAt: "2026-10-20T10:00:00Z", ...extra });
  const data = {
    sheets: [
      sheet("sh_budget", "Budget", [october, notes]),
      sheet("sh_old", "Budget", [notes], { updatedAt: "2026-01-01T10:00:00Z" }),
      sheet("sh_runs", "Runs", [runs], { updatedAt: "2026-10-25T10:00:00Z" }),
      sheet("sh_gone", "Old plans", [runs], { archivedAt: "2026-10-01T00:00:00Z" }),
    ],
  };

  test("adds a column up, worked out and formatted as the sheet shows it, with rows of totals left out", () => {
    const spent = runCells({ sheet: "budget", tab: "october", label: "Category", value: "Amount" }, data);
    assert.equal(spent.sheetId, "sh_budget", "the latest edited of two sheets with the name");
    assert.equal(spent.count, 4);
    assert.equal(spent.value, 30000);
    assert.equal(money(spent.text), "Rs 30,000.00");
    assert.equal(money(spent.average), "Rs 7,500.00");
    assert.equal(money(spent.last), "Rs 25,000.00");
    assert.deepEqual(spent.labels, ["Groceries", "Transport", "groceries", "Rent"]);
    assert.deepEqual(spent.values, [1200, 3000, 800, 25000]);
    // Formulas are worked out: Total = Amount × Qty.
    assert.deepEqual(runCells({ sheet: "Budget", tab: "October", label: "Category", value: "Total" }, data).values, [2400, 3000, 800, 25000]);
  });

  test("groups, sorts, keeps the last rows and limits, saying how many more there are", () => {
    const grouped = runCells({ sheet: "Budget", tab: "October", label: "Category", value: "Amount", group: true, sort: "value", limit: 2 }, data);
    assert.deepEqual(grouped.rows.map((r) => [r.label, r.value, money(r.text), r.share]), [["Rent", 25000, "Rs 25,000.00", 100], ["Transport", 3000, "Rs 3,000.00", 12]]);
    assert.equal(grouped.more, 1);
    assert.equal(grouped.value, 30000, "totals count every matching row, not only those shown");
    assert.deepEqual(runCells({ sheet: "Budget", tab: "October", label: "Category", value: "Amount", group: true, sort: "label" }, data).labels, ["Groceries", "Rent", "Transport"]);
    assert.deepEqual(runCells({ sheet: "Budget", tab: "October", label: "Category", value: "Amount", sort: "value", desc: false }, data).values, [800, 1200, 3000, 25000]);
    assert.deepEqual(runCells({ sheet: "Budget", tab: "October", label: "Date", value: "Amount", last: true, limit: 2 }, data).values, [800, 25000]);
  });

  test("where/is keeps the rows that hold a text, or any text", () => {
    const paid = runCells({ sheet: "Budget", tab: "October", value: "Amount", where: "Paid", is: "YES" }, data);
    assert.equal(paid.value, 27000);
    assert.equal(paid.count, 3);
    assert.equal(runCells({ sheet: "Budget", tab: "October", value: "Amount", where: "paid" }, data).count, 3);
    assert.equal(runCells({ sheet: "Budget", tab: "October", value: "Amount", where: "Paid", is: "no" }, data).count, 0);
  });

  test("names typed in row 1 and letters both find a column; the first text and number columns are the defaults", () => {
    const km = runCells({ sheet: "Runs" }, data);
    assert.deepEqual([km.labels, km.values, km.text], [["Mon", "Tue", "Wed"], [5, 7.5, 3], "15.5"]);
    assert.deepEqual(runCells({ sheet: "Runs", label: "a", value: "B" }, data).values, [5, 7.5, 3]);
    assert.equal(runCells({ sheet: "Runs", tab: "Week", value: "km" }, data).average, "5.17");
  });

  test("a column of text counts its rows", () => {
    const feel = runCells({ sheet: "Runs", label: "Feel", value: "Feel", group: true, sort: "value" }, data);
    assert.deepEqual(feel.rows.map((r) => [r.label, r.text]), [["Good", "2"], ["Tired", "1"]]);
    assert.equal(feel.text, "3");
    assert.equal(feel.average, "–", "a count has no average");
  });

  test("a sheet, tab or column that isn't there shows nothing, never other cells", () => {
    for (const query of [
      { sheet: "Garden" },
      { sheet: "Old plans" },
      { sheet: "Budget", tab: "November" },
      { sheet: "Budget", tab: "Notes" },
      { sheet: "Budget", tab: "October", value: "Price" },
      { sheet: "Budget", tab: "October", label: "Shop", value: "Amount" },
      { sheet: "Budget", tab: "October", value: "Amount", where: "Shop", is: "x" },
    ]) {
      const result = runCells(query, data);
      assert.deepEqual([result.count, result.rows.length, result.value], [0, 0, 0], JSON.stringify(query));
    }
    assert.equal(runCells({ sheet: "Budget", tab: "November" }, data).sheetId, "sh_budget", "the sheet is still there to open");
    assert.equal(runCells({ sheet: "Budget", tab: "October", value: "Amount", where: "Paid", is: "no" }, data).average, "–", "nothing matching shows a dash, not a blank");
  });

  test("cellsProblems names what a program asks for that the sheets don't have", () => {
    const program = (query) => `root = Panel("x", [Stats([Stat("Total", c.text)])])\nc = @Cells(${query})`;
    const problems = (query) => cellsProblems(program(query), data);
    assert.deepEqual(problems('{sheet: "Budget", tab: "October", value: "Amount"}'), []);
    assert.deepEqual(problems('{sheet: "Garden"}'), ["No sheet is called “Garden”."]);
    assert.deepEqual(problems('{sheet: "Old plans"}'), ["No sheet is called “Old plans”."], "an archived sheet is not there");
    assert.deepEqual(problems('{sheet: "budget", tab: "November"}'), ["“Budget” has no tab called “November”."]);
    assert.deepEqual(problems('{sheet: "Budget", tab: "October", value: "Price"}'), ["“Budget” has no column called “Price”."]);
    assert.deepEqual(problems('{sheet: "Budget", tab: "October", label: "Shop", value: "Amount"}'), ["“Budget” has no column called “Shop”."]);
    assert.deepEqual(problems('{sheet: "Budget", tab: "Notes"}'), [], "an empty tab is only empty");
    const ideas = { sheets: [sheet("sh_ideas", "Ideas", [{ id: "t", name: "List", columns: [column("a", "A")], rows: [row("1", { a: "Paint the fence" })] }])] };
    assert.deepEqual(cellsProblems(program('{sheet: "Ideas"}'), ideas), ["“Ideas” has no column of numbers."]);
    assert.deepEqual(problems('{sheet: "Budget", tab: "October", value: "Amount", where: "Paid", is: "no"}'), [], "nothing matching is not missing");
    assert.deepEqual(cellsProblems(program('{sheet: "Garden"}'), {}), [], "nothing is said before the sheets load");
    const twice = 'root = Panel("x", [Stats([Stat("A", a.text), Stat("B", b.text)])])\na = @Cells({sheet: "Garden"})\nb = @Cells({sheet: "Garden", tab: "x"})';
    assert.deepEqual(cellsProblems(twice, data), ["No sheet is called “Garden”."]);
  });

  test("the sheet example draws a chart and totals from the cells", () => {
    const { program } = boardExamples().find((example) => example.program.includes("@Cells"));
    const root = drawBoard(program, data, ctx);
    const [stats, chart] = root.props.blocks;
    assert.deepEqual(stats.props.items.map((item) => money(item.props.value)), ["Rs 30,000.00", "Rs 7,500.00"]);
    assert.equal(chart.typeName, "BarChart");
    assert.deepEqual(chart.props.labels, ["Rent", "Transport", "Groceries"]);
    assert.deepEqual(chart.props.values, [25000, 3000, 2000]);
  });

  test("a dashboard card of a sheet keeps its program when saved; older apps draw the list of sheets", async () => {
    const { describedCard } = await import("../packages/contract/src/genuiBoard.ts");
    const { normalizeDashboard } = await import("../packages/contract/src/dashboard.ts");
    const { words, program } = boardExamples().find((example) => example.program.includes("@Cells"));
    const card = describedCard("c1", words, program, data);
    assert.equal(card.title, "Spending by category");
    assert.equal(card.query.source, "sheets");
    assert.equal(card.query.sheet, undefined);
    assert.equal(normalizeDashboard({ version: 1, cards: [card] }).cards[0].query.described.program, program);
  });

  test("a program with @Cells loads sheets, and Describe offers a chart of the latest sheet", () => {
    const program = 'root = Panel("Km", [BarChart("Km", r.labels, r.values)])\nr = @Cells({sheet: "Runs"})';
    assert.deepEqual(describedSources(program), ["sheets"]);
    assert.ok(sourcesUsed(liveBlockCards([program])).has("sheets"));
    const offered = describeExamples(data.sheets);
    assert.equal(offered.length, DESCRIBE_EXAMPLES.length);
    assert.equal(offered.at(-1), "A chart of my Runs sheet");
    assert.deepEqual(describeExamples([]), DESCRIBE_EXAMPLES);
    assert.ok(describeChanges(program).includes("Only the latest entries"), "a sheet's card is offered changes for a sheet");
    assert.ok(!describeChanges(program).includes("Only the overdue ones"));
    assert.deepEqual(describeChanges('root = Panel("x", [])\nt = @Data({source: "tasks"})'), DESCRIBE_CHANGES);
  });
});

describe("@Cells: values as the sheet writes them", async () => {
  const { cellsProblems, drawBoard, runCells } = await import("../packages/contract/src/genuiBoard.ts");
  const { cellsBrief, closestValue } = await import("../packages/contract/src/sheetCells.ts");
  const { buildYearlyExpenses } = await import("../packages/contract/src/sheetTemplates.ts");
  // Timely's yearly expenses workbook with six October entries: 95,750 spent, the biggest 80,000.
  const workbook = buildYearlyExpenses({ year: 2026, currency: "LKR" });
  const october = workbook.tabs.find((tab) => tab.name === "October");
  const col = Object.fromEntries(october.columns.map((column) => [column.name, column.id]));
  const entries = [
    ["2026-10-02", "Rice 5kg", "Groceries", "2500"],
    ["2026-10-03", "Bus pass", "Transport", "1750"],
    ["2026-10-05", "Rent", "Rent", "80000"],
    ["2026-10-08", "Vegetables", "Groceries", "1000"],
    ["2026-10-12", "Dinner", "Dining out", "4500"],
    ["2026-10-20", "Electricity", "Bills & utilities", "6000"],
  ];
  entries.forEach(([date, item, category, price], i) => {
    Object.assign(october.rows[i + 1].cells, { [col.Date]: date, [col.Item]: item, [col.Category]: category, [col["Unit price"]]: price });
  });
  const data = { sheets: [{ ...workbook, id: "sh_exp", workspaceId: "ws1", updatedAt: "2026-10-28T10:00:00Z" }] };
  const money = (text) => text.replace(/ /g, " ");
  // The program the AI wrote for "October expenses": the Summary tab says October, the AI wrote Oct.
  const program = `root = Panel("October expenses", [nums, list])
spent = @Cells({sheet: "Expenses 2026", tab: "Summary", label: "Month", value: "Spent", where: "Month", is: "Oct"})
items = @Cells({sheet: "Expenses 2026", tab: "Summary", label: "Month", value: "Items", where: "Month", is: "Oct"})
big = @Cells({sheet: "Expenses 2026", tab: "Summary", label: "Month", value: "Biggest buy", where: "Month", is: "Oct"})
nums = Stats([Stat("Spent this month", spent.text), Stat("Items", items.text), Stat("Biggest buy", big.text)])
list = List(@Each(spent.rows, "r", InfoRow(r.label, r.text)), "No October row found", open)
open = Open("Open sheet", "sheet", spent.sheetId)`;

  test("a month's short name finds the month's row: Oct is October", () => {
    const ask = (is, value = "Spent") => runCells({ sheet: "Expenses 2026", tab: "Summary", label: "Month", value, where: "Month", is }, data);
    assert.equal(ask("Oct").value, 95750);
    assert.equal(ask("Oct").count, 1);
    assert.equal(ask("Oct", "Items").value, 6);
    assert.equal(ask("Oct", "Biggest buy").value, 80000);
    for (const is of ["October", "OCTOBER", " oct. ", "Oct."]) assert.equal(ask(is).value, 95750, is);
    assert.equal(ask("Sept").count, 1, "Sept is September");
    assert.equal(ask("Sep").value, 0, "September spent nothing");
    assert.deepEqual(cellsProblems(program, data), [], "nothing missing");
    const drawn = JSON.stringify(drawBoard(program, data, { now: new Date("2026-10-28T12:00:00Z"), timeZone: "UTC" }));
    assert.match(money(drawn), /95,750/, "the block shows October's spending");
    assert.match(drawn, /"October"/, "the list has October's row");
  });

  test("Year total and Monthly average are totals rows, not months", () => {
    const year = runCells({ sheet: "Expenses 2026", tab: "Summary", label: "Month", value: "Spent" }, data);
    assert.equal(year.count, 12, "twelve months");
    assert.equal(year.value, 95750, "not counted again by Year total and Monthly average");
    assert.ok(!year.labels.includes("Year total"));
    const categories = runCells({ sheet: "Expenses 2026", tab: "Categories", label: "Category", value: "Oct", sort: "value", limit: 3 }, data);
    assert.deepEqual(categories.labels, ["Rent", "Bills & utilities", "Dining out"]);
    assert.equal(categories.value, 95750, "the Categories tab's Total row is left out too");
  });

  test("is also matches a number however the cell shows it", () => {
    assert.equal(runCells({ sheet: "Expenses 2026", tab: "October", label: "Item", value: "Total", where: "Total", is: "80000" }, data).labels[0], "Rent");
    assert.equal(runCells({ sheet: "Expenses 2026", tab: "October", label: "Item", value: "Total", where: "Total", is: "80,000" }, data).count, 1);
  });

  test("a near miss shows a note naming the value the column holds, not other numbers", () => {
    const near = program.replace(/tab: "Summary", label: "Month", value: "Spent", where: "Month", is: "Oct"/, 'tab: "October", label: "Item", value: "Total", where: "Category", is: "Grocery"');
    assert.deepEqual(cellsProblems(near, data), ["“Expenses 2026” has no Category called “Grocery”. The closest is “Groceries”."]);
    assert.equal(runCells({ sheet: "Expenses 2026", tab: "October", value: "Total", where: "Category", is: "Grocery" }, data).value, 0, "a near miss draws nothing");
    // A value nothing like the column's only matches no rows yet: no note.
    const none = program.replace(/where: "Month", is: "Oct"/, 'where: "Month", is: "Q4"');
    assert.deepEqual(cellsProblems(none, data), []);
    assert.equal(closestValue(["Groceries", "Transport"], "Gro"), "Groceries");
    assert.equal(closestValue(["Dining out"], "Dining"), "Dining out");
    assert.equal(closestValue(["yes"], "no"), "");
    assert.equal(closestValue(["Rent", "Transport"], "Travel"), "");
  });

  test("the AI is told the values a column of text holds", () => {
    const tabs = cellsBrief(data.sheets[0]);
    const column = (tab, name) => tabs.find((t) => t.name === tab).columns.find((c) => c.name === name);
    assert.deepEqual(column("Summary", "Month").values, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
    assert.equal(column("Summary", "Spent").values, undefined, "numbers list no values");
    assert.equal(column("Summary", "Notes").values, undefined, "nothing typed outside the totals rows");
    assert.deepEqual(column("October", "Category").values, ["Groceries", "Transport", "Rent", "Dining out", "Bills & utilities"]);
    assert.equal(tabs.find((t) => t.name === "Summary").rows, 12);
  });
});

describe("check_block: a draft drawn from the person's data", async () => {
  const { checkBoard } = await import("../packages/contract/src/boardCheck.ts");
  const { dataProblems } = await import("../packages/contract/src/genuiBoard.ts");
  const data = {
    workspaces: [{ id: "w1", name: "Work", status: [{ id: "s1", name: "In progress" }], lables: [{ id: "l1", name: "Urgent" }] }],
    projects: [{ id: "p1", title: "Client work" }],
    tasks: [
      { id: "t1", name: "Send invoice", kind: "task", deadline: "2026-10-20T10:00:00Z", project: { id: "p1", title: "Client work" } },
      { id: "t2", name: "Plan week", kind: "task", deadline: "2026-11-20T10:00:00Z", project: { id: "p1", title: "Client work" } },
    ],
  };
  const ctx = { now: new Date("2026-10-29T08:00:00Z"), timeZone: "UTC" };
  const program = `root = Panel("Client work", [nums, list])
late = @Data({source: "tasks", project: "Client work", overdue: true})
nums = Stats([Stat("Overdue", late.text)])
list = List(@Each(late.rows, "t", TaskRow(t.id, t.title, t.day)), "Nothing overdue")`;

  test("shows each block as the apps draw it", () => {
    const { problems, shows } = checkBoard(program, data, ctx);
    assert.deepEqual(problems, []);
    assert.deepEqual(shows, [
      'Panel title: "Client work"',
      "  Stats",
      '    Stat label: "Overdue", value: "1"',
      '  List empty: "Nothing overdue"',
      '    TaskRow taskId: "t1", title: "Send invoice", time: "20 Oct"',
    ]);
    const none = checkBoard(program.replace("overdue: true", 'overdue: true, text: "nothing like this"'), data, ctx).shows;
    assert.ok(none.includes('  List rows: [], empty: "Nothing overdue"'), "an empty list says so");
  });

  test("names what fits nothing, with the closest name", () => {
    const wrong = program.replace('project: "Client work"', 'project: "Clients work", workspace: "Wrok", label: "Urgnt", status: "Done"');
    assert.deepEqual(dataProblems(wrong, data), [
      "No project is called “Clients work”. The closest is “Client work”.",
      "No workspace is called “Wrok”. The closest is “Work”.",
      "No label is called “Urgnt”. The closest is “Urgent”.",
      "No status is called “Done”.",
    ]);
    assert.deepEqual(dataProblems(program.replace("Client work", "CLIENT WORK"), data), [], "names match without case");
    const broken = checkBoard(`${program.replace("nums = Stats([Stat(\"Overdue\", late.text)])", "nums = Stats([Stat(\"Overdue\", soon.text)])")}\nspare = Text("x")`, data, ctx).problems;
    assert.ok(broken.includes("soon is used but never defined."), broken.join("\n"));
    assert.ok(broken.some((problem) => problem.startsWith("spare is defined but no block shows it")), broken.join("\n"));
    assert.deepEqual(checkBoard("hello", data, ctx).problems, ["The program has no root = Panel(...) line."]);
  });

  test("the API's bundled check matches packages/contract and runs on its own", async () => {
    const { bundleBoardCheck } = await import("./gen-board-check.mjs");
    const source = readFileSync(new URL("../apps/api/internal/features/provider/board/board-check.js", import.meta.url), "utf8");
    assert.ok(source === (await bundleBoardCheck()), "board-check.js is out of date: run make gen-board-check");
    const bundle = new Function(`${source};return BoardCheck;`)();
    const answer = JSON.parse(bundle.check(JSON.stringify({ program, data, now: "2026-10-29T08:00:00Z", timeZone: "UTC" })));
    assert.deepEqual(answer, checkBoard(program, data, ctx));
  });
});

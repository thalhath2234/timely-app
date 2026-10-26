import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { genuiParser, genuiPrompt, replyText, splitReply } from "../packages/contract/src/genui.ts";

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
  test("flags components outside the list", () => {
    const result = genuiParser().parse('root = Reply([x])\nx = Script("alert(1)")');
    assert.ok(result.meta.errors.some((e) => e.code === "unknown-component"));
  });
});

describe("described cards", async () => {
  const { boardExamples, boardParser, boardPrompt, describedCard, drawBoard, runData } = await import("../packages/contract/src/genuiBoard.ts");
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
    assert.ok(board.length < 13000, `prompt is ${board.length} characters`);
  });

  test("its examples parse with no errors", () => {
    const examples = boardExamples();
    assert.equal(examples.length, 4);
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
});

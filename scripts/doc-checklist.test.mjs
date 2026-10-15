import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  checklistTask,
  checklistTaskDescription,
  checklistTaskName,
  draftChecklistTasks,
  openChecklistItems,
} from "../packages/contract/src/docChecklist.ts";

const para = (...content) => ({ type: "paragraph", content: content.map((c) => (typeof c === "string" ? { type: "text", text: c } : c)) });
const item = (checked, ...content) => ({ type: "taskItem", attrs: { checked }, content });
const list = (...items) => ({ type: "taskList", content: items });

describe("checklistTaskName", () => {
  test("a one-sentence item is the name", () => {
    assert.deepEqual(checklistTaskName("Add predictive back gesture"), { name: "Add predictive back gesture", details: "" });
    assert.deepEqual(checklistTaskName("Buy milk."), { name: "Buy milk", details: "" });
  });

  test("the first sentence names the task, the rest is detail", () => {
    assert.deepEqual(
      checklistTaskName("Add android widgets same as in the dashboard. Also custom widgets a user create in timely should also become an android widget"),
      { name: "Add android widgets same as in the dashboard", details: "Also custom widgets a user create in timely should also become an android widget" },
    );
    assert.deepEqual(checklistTaskName("Ask Dr. smith about it"), { name: "Ask Dr. smith about it", details: "" });
    assert.deepEqual(checklistTaskName("Is it done? Check with Sam"), { name: "Is it done?", details: "Check with Sam" });
  });

  test("a very long sentence is cut at a word, keeping all of it as detail", () => {
    const long = `Plan ${"the big long launch ".repeat(15)}now`;
    const { name, details } = checklistTaskName(long);
    assert.ok([...name].length <= 200, name);
    assert.ok(name.endsWith("…"));
    assert.equal(details, long.replace(/\s+/g, " ").trim());
  });
});

describe("openChecklistItems", () => {
  test("only unchecked, non-empty items that link no task, nested ones too", () => {
    const content = {
      type: "doc",
      content: [
        para("Some notes"),
        list(
          item(false, para("Add predictive back gesture")),
          item(true, para("Done already")),
          item(false, para("  ")),
          item(false, para("Track ", { type: "mention", attrs: { id: "t1", label: "Widget", entityType: "task" } })),
          item(false, para("Read ", { type: "mention", attrs: { id: "d1", label: "Spec", entityType: "doc" } }), list(item(false, para("Nested step")))),
          item(false, para("add predictive back gesture")),
        ),
        { type: "codeBlock", content: [list(item(false, para("not a to-do")))] },
      ],
    };
    assert.deepEqual(
      openChecklistItems(content).map((t) => t.name),
      ["Add predictive back gesture", "Read Spec", "Nested step"],
    );
  });

  test("an empty or missing doc has none", () => {
    assert.deepEqual(openChecklistItems(undefined), []);
    assert.deepEqual(openChecklistItems({ type: "doc" }), []);
  });
});

describe("checklistTaskDescription", () => {
  test("links back to the doc after any detail", () => {
    const out = checklistTaskDescription("More words", { id: "doc_1", title: "Timely ideas" });
    assert.equal(out.description, "More words\n\nFrom Timely ideas");
    assert.equal(out.descriptionRich.content.length, 2);
    assert.deepEqual(out.descriptionRich.content[1].content[1], { type: "mention", attrs: { id: "doc_1", label: "Timely ideas", entityType: "doc" } });
    assert.equal(checklistTaskDescription("", { id: "d", title: " " }).description, "From Untitled");
  });
});

describe("AI titles for checklist tasks", () => {
  const doc = { id: "doc_1", title: "Timely ideas" };
  const todo = {
    text: "Use ai generated text to generate title for the sugggested task. Use default selected model for thus",
    name: "Use ai generated text to generate title for the sugggested task",
    details: "Use default selected model for thus",
  };

  test("a draft names the task, leads its description and quotes the item after the doc link", () => {
    const out = checklistTask(todo, doc, { title: "Generate AI titles for suggested tasks", description: "Name new tasks with the default model." });
    assert.equal(out.name, "Generate AI titles for suggested tasks");
    assert.equal(out.description, `Name new tasks with the default model.\n\nFrom Timely ideas: “${todo.text}”`);
    const [lead, from] = out.descriptionRich.content;
    assert.equal(lead.content[0].text, "Name new tasks with the default model.");
    assert.deepEqual(from.content[1], { type: "mention", attrs: { id: "doc_1", label: "Timely ideas", entityType: "doc" } });
    assert.equal(from.content[2].text, `: “${todo.text}”`);
  });

  test("an empty draft description keeps only the link and the quote", () => {
    const out = checklistTask(todo, doc, { title: "Generate titles", description: " " });
    assert.equal(out.description, `From Timely ideas: “${todo.text}”`);
    assert.equal(out.descriptionRich.content.length, 1);
  });

  test("no draft keeps today's name and description", () => {
    for (const draft of [null, undefined, { title: "  ", description: "x" }]) {
      const out = checklistTask(todo, doc, draft);
      assert.equal(out.name, todo.name);
      assert.equal(out.description, `${todo.details}\n\nFrom Timely ideas`);
    }
  });

  test("one request for every item, answers matched by position", async () => {
    const calls = [];
    const second = { text: "ship", name: "ship", details: "" };
    const out = await draftChecklistTasks([todo, second], doc, async (body) => {
      calls.push(body);
      return { items: [{ title: " Generate  titles ", description: "Short." }, { title: "", description: "" }], provider: "openrouter", model: "m" };
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { docTitle: "Timely ideas", items: [{ name: todo.name, details: todo.details }, { name: "ship", details: "" }] });
    assert.deepEqual(out, [{ title: "Generate titles", description: "Short." }, null]);
  });

  test("an error or a slow answer falls back to the items' own words", async () => {
    assert.deepEqual(await draftChecklistTasks([todo], doc, async () => { throw new Error("409"); }), [null]);
    let aborted = false;
    const started = Date.now();
    const out = await draftChecklistTasks(
      [todo],
      doc,
      (_body, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; });
          setTimeout(() => resolve({ items: [{ title: "Late", description: "" }], provider: "", model: "" }), 500);
        }),
      30,
    );
    assert.deepEqual(out, [null]);
    assert.ok(aborted, "the request is aborted at the deadline");
    assert.ok(Date.now() - started < 400);
    assert.deepEqual(await draftChecklistTasks([], doc, async () => assert.fail("no request without items")), []);
  });
});

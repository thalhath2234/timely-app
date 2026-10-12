import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { checklistTaskDescription, checklistTaskName, openChecklistItems } from "../packages/contract/src/docChecklist.ts";

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

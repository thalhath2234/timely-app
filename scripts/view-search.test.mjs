import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { matchViewByName } from "../packages/contract/src/viewSearch.ts";

// The phone's built-in views plus a project view, as on the Tasks tab.
const views = [
  { id: "native_view_task_list", name: "Task List" },
  { id: "native_view_my_deadlines", name: "My Deadlines" },
  { id: "native_view_overview", name: "Overview" },
  { id: "native_view_board", name: "Board" },
  { id: "projects", name: "Projects" },
  { id: "attention", name: "Needs attention" },
];
const pick = (query) => matchViewByName(query, views)?.id;

describe("matchViewByName", () => {
  test("finds a view by loose phrasings of its name", () => {
    for (const query of [
      "show my deadline",
      "my deadlines",
      "Deadlines",
      "open my deadlines view",
      "show me the deadlines tab",
      "due",
    ]) {
      assert.equal(pick(query), "native_view_my_deadlines", query);
    }
    assert.equal(pick("board"), "native_view_board");
    assert.equal(pick("kanban"), "native_view_board");
    assert.equal(pick("show the board"), "native_view_board");
    assert.equal(pick("overview"), "native_view_overview");
    assert.equal(pick("task list"), "native_view_task_list");
    assert.equal(pick("list tasks"), "native_view_task_list");
    assert.equal(pick("projects"), "projects");
    assert.equal(pick("what needs attention"), "attention");
  });

  test("the last word may be cut short while typing", () => {
    assert.equal(pick("show my dead"), "native_view_my_deadlines");
    assert.equal(pick("overv"), "native_view_overview");
    assert.equal(pick("boa"), undefined);
    assert.equal(pick("dead board"), undefined);
  });

  test("a search for one item or something else opens no view", () => {
    for (const query of [
      "",
      "show my",
      "task",
      "tasks",
      "deadline report",
      "throw away trash",
      "board meeting notes",
      "my view",
    ]) {
      assert.equal(pick(query), undefined, query);
    }
  });

  test("an exact name wins over a cut-short one", () => {
    const both = [
      { id: "a", name: "Overview later" },
      { id: "b", name: "Over" },
    ];
    assert.equal(matchViewByName("over", both)?.id, "b");
    assert.equal(
      matchViewByName("over", [{ id: "a", name: "Overview" }])?.id,
      "a",
    );
  });
});

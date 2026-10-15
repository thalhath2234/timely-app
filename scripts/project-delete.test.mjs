import assert from "node:assert/strict";
import test from "node:test";
import { projectDeleteCopy } from "../packages/contract/src/projectDelete.ts";

// Deleting a project deletes its tasks, so the confirm must say how many.
test("names the tasks and stages that go with the project", () => {
  assert.deepEqual(projectDeleteCopy("Website relaunch", 5, 3), {
    title: "Delete “Website relaunch”?",
    description: "Its 5 tasks and 3 stages are deleted with it. This can’t be undone.",
    confirmLabel: "Delete project and 5 tasks",
  });
});

test("singular and empty cases read naturally", () => {
  assert.equal(projectDeleteCopy("A", 1, 0).description, "Its 1 task is deleted with it. This can’t be undone.");
  assert.equal(projectDeleteCopy("A", 1, 0).confirmLabel, "Delete project and 1 task");
  assert.equal(projectDeleteCopy("A", 0, 1).description, "Its 1 stage is deleted with it. This can’t be undone.");
  assert.equal(projectDeleteCopy("A", 0, 0).description, "This can’t be undone.");
  assert.equal(projectDeleteCopy("A", 0, 2).confirmLabel, "Delete project");
  assert.equal(projectDeleteCopy("  ", 0, 0).title, "Delete “Untitled”?");
});

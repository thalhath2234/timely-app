import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { bulkUndoSnapshot, labelIdsWithNamed, mergeLabelsByName, taskLabelIds } from "../packages/contract/src/bulkEdit.ts";

const task = (id, extra = {}) => ({
  id,
  name: id,
  completedAt: null,
  statusId: null,
  priorityLevel: null,
  projectId: null,
  deadline: null,
  ...extra,
});

const L = (id, name, workspaceId) => ({ id, name, workspaceId, color: "#000" });
const labels = [L("w1-deep", "Deep work", "w1"), L("w2-deep", "Deep work", "w2"), L("w1-urgent", "Urgent", "w1"), L("w1-urgent2", " urgent ", "w1")];

describe("mergeLabelsByName", () => {
  test("lists each label name once across workspaces", () => {
    const groups = mergeLabelsByName(labels);
    assert.deepEqual(groups.map((g) => g.name), ["Deep work", "Urgent"]);
    assert.deepEqual(groups[0].labels.map((l) => l.id), ["w1-deep", "w2-deep"]);
  });
});

describe("labelIdsWithNamed", () => {
  const [deep] = mergeLabelsByName(labels);

  test("adds the task's own workspace label to the ones it already has", () => {
    const t = task("a", { workspaceId: "w2", labels: [{ id: "w2-thesis", name: "Thesis" }] });
    assert.deepEqual(labelIdsWithNamed(t, deep), [{ id: "w2-thesis" }, { id: "w2-deep" }]);
  });

  test("a label the task already has is not added twice", () => {
    const t = task("a", { workspaceId: "w1", labelIds: [{ id: "w1-deep" }] });
    assert.deepEqual(labelIdsWithNamed(t, deep), [{ id: "w1-deep" }]);
  });

  test("falls back to the nested workspace", () => {
    const t = task("a", { workspaceId: null, workspace: { id: "w1" } });
    assert.deepEqual(labelIdsWithNamed(t, deep), [{ id: "w1-deep" }]);
  });

  test("null when the task's workspace has no label of that name", () => {
    assert.equal(labelIdsWithNamed(task("a", { workspaceId: "w3" }), deep), null);
  });
});

describe("bulkUndoSnapshot", () => {
  test("keeps each task's own previous value", () => {
    const before = bulkUndoSnapshot(
      [task("a", { priorityLevel: "High" }), task("b", { priorityLevel: "Low" }), task("c")],
      ["priorityLevel"],
    );
    assert.deepEqual(before.get("a"), { priorityLevel: "High" });
    assert.deepEqual(before.get("b"), { priorityLevel: "Low" });
    assert.deepEqual(before.get("c"), { priorityLevel: "" });
  });

  test("empty values come back as \"\" so Undo clears what the edit set", () => {
    const before = bulkUndoSnapshot([task("a")], ["projectId", "deadline", "completedAt", "statusId"]);
    assert.deepEqual(before.get("a"), { projectId: "", deadline: "", completedAt: "", statusId: "" });
  });

  test("project and status read from the nested object when the id is missing", () => {
    const before = bulkUndoSnapshot(
      [task("a", { project: { id: "p1" }, status: { id: "s1" } })],
      ["projectId", "statusId"],
    );
    assert.deepEqual(before.get("a"), { projectId: "p1", statusId: "s1" });
  });

  test("labels merge both shapes the API sends", () => {
    const t = task("a", { labels: [{ id: "x", name: "X" }], labelIds: [{ id: "y" }] });
    assert.deepEqual(taskLabelIds(t), [{ id: "x" }, { id: "y" }]);
    assert.deepEqual(bulkUndoSnapshot([t], ["labelIds"]).get("a"), { labelIds: [{ id: "x" }, { id: "y" }] });
  });
});

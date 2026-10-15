import assert from "node:assert/strict";
import test, { describe } from "node:test";

const { splitStarterLabels } = await import("../packages/contract/src/starterLabels.ts");

const options = [
  { key: "work", workspace: "Work" },
  { key: "study", workspace: "Study" },
  { key: "health", workspace: "Health" },
];
const labels = [
  { name: "Urgent", color: "#E5484D", uses: ["work", "personal"] },
  { name: "Deep work", color: "#6E56CF", uses: ["work", "study", "creative"] },
  { name: "Exam", color: "#E5484D", uses: ["study"] },
  { name: "Workout", color: "#46A758", uses: ["health"] },
];
const names = (list) => list.map((l) => l.name);

describe("splitStarterLabels", () => {
  test("each extra workspace gets its use's labels, the first keeps the rest", () => {
    const { first, extras } = splitStarterLabels(labels, ["work", "study", "health"], options, ["Study", "Health"]);
    assert.deepEqual(names(first), ["Urgent", "Deep work"]);
    assert.deepEqual(names(extras.Study), ["Deep work", "Exam"]);
    assert.deepEqual(names(extras.Health), ["Workout"]);
  });

  test("with no extra workspaces everything stays in the first", () => {
    const { first, extras } = splitStarterLabels(labels, ["work", "study", "health"], options, []);
    assert.deepEqual(names(first), names(labels));
    assert.deepEqual(extras, {});
  });

  test("the first workspace keeps every label when each use has its own workspace", () => {
    const { first, extras } = splitStarterLabels(labels, ["work", "study"], options, ["Work", "Study"]);
    assert.deepEqual(names(first), names(labels));
    assert.deepEqual(names(extras.Work), ["Urgent", "Deep work"]);
  });

  test("workspace names match without case, labels without uses stay first", () => {
    const old = [{ name: "Inbox zero", color: "#000" }, ...labels];
    const { first, extras } = splitStarterLabels(old, ["work", "health"], options, ["health"]);
    assert.deepEqual(names(first), ["Inbox zero", "Urgent", "Deep work"]);
    assert.deepEqual(names(extras.health), ["Workout"]);
  });
});

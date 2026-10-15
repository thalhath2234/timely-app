import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  choiceSelected,
  newCondition,
  replaceRule,
  ruleChoices,
  ruleFieldChoices,
  ruleOpChoices,
  toggleChoice,
  withOp,
} from "../packages/contract/src/ruleBuilder.ts";
import { aiDraftPatch, readViewQuery, readingPatch } from "../packages/contract/src/viewLanguage.ts";
import { filterTasks, filtersFromView } from "../packages/contract/src/taskQuery.ts";

const TODAY = "2026-10-14";
const customFields = [
  { id: "c1", name: "Type", type: "select", options: { options: [{ id: "o1", value: "Feature", color: "#f00" }] } },
  { id: "c1", name: "Type", type: "select", options: { options: [] } },
];
const vocab = {
  statuses: [
    { id: "s1", name: "In Progress" },
    { id: "s2", name: "Done" },
    { id: "s3", name: "In progress" },
  ],
  labels: [{ id: "l1", name: "bug", color: "#0f0" }],
  customFields,
};

describe("rule builder", () => {
  test("lists every field once, custom fields last, project lists without workspace/project", () => {
    const all = ruleFieldChoices(customFields);
    assert.equal(all.filter((item) => item.field === "cf:c1").length, 1);
    assert.equal(all.at(-1).section, "Custom fields");
    assert.equal(all[0].field, "deadline");
    const project = ruleFieldChoices([], { scope: "project" }).map((item) => item.field);
    assert.ok(!project.includes("project") && !project.includes("workspace"));
  });

  test("conditions read as words", () => {
    assert.deepEqual(ruleOpChoices("done"), [{ value: "is", label: "is" }]);
    assert.equal(ruleOpChoices("deadline")[0].label, "is in");
    assert.equal(ruleOpChoices("label").find((op) => op.value === "allOf").label, "has all of");
  });

  test("a new rule already does something", () => {
    assert.deepEqual(newCondition("deadline"), { field: "deadline", op: "in", value: "thisWeek" });
    assert.deepEqual(newCondition("blocked"), { field: "blocked", op: "is", value: true });
    assert.deepEqual(newCondition("label"), { field: "label", op: "anyOf", value: [] });
  });

  test("changing the condition reshapes the value", () => {
    const priority = { field: "priority", op: "anyOf", value: ["Urgent", "High"] };
    assert.deepEqual(withOp(priority, "gte"), { field: "priority", op: "gte", value: "Urgent" });
    assert.deepEqual(withOp({ field: "priority", op: "gte", value: "High" }, "anyOf"), { field: "priority", op: "anyOf", value: ["High"] });
    assert.deepEqual(withOp({ field: "deadline", op: "in", value: "thisWeek" }, "between"), {
      field: "deadline",
      op: "between",
      value: "thisWeek",
      to: "+7",
    });
    assert.deepEqual(withOp({ field: "deadline", op: "in", value: "thisWeek" }, "isEmpty"), { field: "deadline", op: "isEmpty" });
  });

  test("statuses of one name are one choice", () => {
    const statuses = ruleChoices("status", vocab);
    assert.deepEqual(statuses.map((item) => [item.label, item.ids]), [
      ["In Progress", ["s1", "s3"]],
      ["Done", ["s2"]],
    ]);
    let rule = { field: "status", op: "anyOf", value: [] };
    rule = toggleChoice(rule, statuses[0]);
    assert.deepEqual(rule.value, ["s1", "s3"]);
    assert.equal(choiceSelected(rule, statuses[0]), true);
    assert.deepEqual(toggleChoice(rule, statuses[0]).value, []);
    assert.equal(ruleChoices("cf:c1", vocab)[0].label, "Feature");
    assert.equal(ruleChoices("priority").length, 4);
  });

  test("replaceRule edits and removes by index", () => {
    const rules = [newCondition("done"), newCondition("deadline")];
    assert.equal(replaceRule(rules, 0, null).length, 1);
    assert.equal(replaceRule(rules, 1, newCondition("blocked"))[1].field, "blocked");
  });
});

describe("describe box patch", () => {
  test("words replace the filters and keep groups and layout unless named", () => {
    const patch = readingPatch(readViewQuery("urgent tasks", vocab, { today: TODAY }));
    assert.deepEqual(patch.rules, [{ field: "priority", op: "anyOf", value: ["Urgent"] }]);
    assert.deepEqual(patch.selectedLabelIds, []);
    assert.equal("groupFields" in patch, false);
    assert.equal("renderMode" in patch, false);
    assert.equal("limit" in patch, false);
    const named = readingPatch(readViewQuery("top 5 overdue tasks grouped by priority as a board", vocab, { today: TODAY }));
    assert.equal(named.limit, 5);
    assert.equal(named.renderMode, "kanban");
    assert.deepEqual(named.groupFields, ["priority"]);
    assert.equal(named.sortBy, "deadline");
  });

  test("an AI answer patches only what it filled in", () => {
    const patch = aiDraftPatch({ rules: [{ field: "blocked", op: "is", value: true }] });
    assert.deepEqual(patch.rules, [{ field: "blocked", op: "is", value: true }]);
    assert.equal("sortBy" in patch, false);
    assert.equal("groupFields" in patch, false);
    assert.equal(aiDraftPatch({ sortBy: "priority", sortDirection: "desc" }).sortDirection, "desc");
  });

  test("a built rule runs in the engine", () => {
    const tasks = [
      { id: "a", name: "A", duration: 30, kind: "task", priorityLevel: "High", deadline: "2026-10-15" },
      { id: "b", name: "B", duration: 30, kind: "task", priorityLevel: "Low", deadline: "2026-10-30" },
    ];
    const rule = withOp(newCondition("priority"), "gte");
    const view = { id: "v", name: "v", rules: [rule, newCondition("deadline")], showCompleted: true };
    const shown = filterTasks(tasks, filtersFromView(view), "UTC", { now: new Date(`${TODAY}T12:00:00Z`) });
    assert.deepEqual(shown.map((task) => task.id), ["a"]);
  });
});

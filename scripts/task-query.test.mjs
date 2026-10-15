import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  bucketGroupLabels,
  bucketGroupRank,
  compareTasks,
  filterTasks,
  filtersFromView,
  normalizeRules,
  queryContext,
  resolveDateValue,
  runView,
} from "../packages/contract/src/taskQuery.ts";

const NOW = new Date("2026-10-14T10:00:00Z"); // Wednesday, UTC

function task(id, fields = {}) {
  return {
    id,
    name: id,
    description: "",
    duration: 30,
    kind: "task",
    deadline: null,
    startDate: null,
    scheduledOn: null,
    completedAt: null,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-10",
    userId: "u",
    projectId: null,
    statusId: null,
    priorityLevel: null,
    workspaceId: "w1",
    scheduleId: null,
    stageId: null,
    blockedById: null,
    ...fields,
  };
}

const tasks = [
  task("a", { deadline: "2026-10-13", priorityLevel: "High", labels: [{ id: "l1", name: "bug" }] }),
  task("b", { deadline: "2026-10-16", priorityLevel: "Urgent", duration: 120 }),
  task("c", { deadline: null, priorityLevel: "Low", blockedById: "b" }),
  task("d", { completedAt: "2026-10-12T09:00:00Z", deadline: "2026-10-10" }),
  task("e", { blocks: [{ id: "x", start: "2026-10-15T09:00:00Z", end: "2026-10-15T10:00:00Z" }], updatedAt: "2026-09-01" }),
  task("f", {
    customFieldValues: [
      { customFieldValueId: "v", customFieldId: "c1", type: "select", optionValue: [{ id: "o1", value: "Feature", color: "" }], createdAt: "", updatedAt: "" },
      { customFieldValueId: "w", customFieldId: "c3", type: "number", stringValue: "5", createdAt: "", updatedAt: "" },
    ],
  }),
  task("r", { kind: "reminder", duration: 0, scheduledOn: "2026-10-14T09:00:00Z" }),
];

const base = { workspaceIds: [], statusIds: [], projectIds: [], priorityLevels: [], labelIds: [], stageIds: [], showCompleted: true, onlyOverdue: false, onlyScheduled: false, onlyRecurring: false, onlyDated: false, showReminders: false };
const ids = (rules, extra = {}) => filterTasks(tasks, { ...base, ...extra, rules }, "UTC", { now: NOW }).map((item) => item.id);

describe("rules", () => {
  test("dates read relative words from today", () => {
    assert.deepEqual(resolveDateValue("thisWeek", "2026-10-14"), { from: "2026-10-12", to: "2026-10-18" });
    assert.deepEqual(resolveDateValue("next:3", "2026-10-14"), { from: "2026-10-14", to: "2026-10-17" });
    assert.deepEqual(resolveDateValue("-30", "2026-10-14"), { from: "2026-09-14", to: "2026-09-14" });
    assert.deepEqual(ids([{ field: "deadline", op: "in", value: "thisWeek" }]), ["a", "b"]);
    assert.deepEqual(ids([{ field: "deadline", op: "before", value: "today" }]), ["a", "d"]);
    assert.deepEqual(ids([{ field: "deadline", op: "isEmpty" }]), ["c", "e", "f"]);
    assert.deepEqual(ids([{ field: "planned", op: "in", value: "tomorrow" }]), ["e"]);
    assert.deepEqual(ids([{ field: "updatedAt", op: "before", value: "-30" }]), ["e"]);
    assert.deepEqual(ids([{ field: "completedAt", op: "in", value: "thisWeek" }]), ["d"]);
  });

  test("flags", () => {
    assert.deepEqual(ids([{ field: "overdue", op: "is", value: true }]), ["a"]);
    assert.deepEqual(ids([{ field: "blocked", op: "is", value: true }]), ["c"]);
    assert.deepEqual(ids([{ field: "blocking", op: "is", value: true }]), ["b"]);
    assert.deepEqual(ids([{ field: "done", op: "is", value: false }]).includes("d"), false);
    assert.deepEqual(ids([{ field: "scheduled", op: "is", value: true }]), ["e"]);
  });

  test("choices, priority levels, numbers, text and custom fields", () => {
    assert.deepEqual(ids([{ field: "priority", op: "gte", value: "High" }]), ["a", "b"]);
    assert.deepEqual(ids([{ field: "priority", op: "anyOf", value: ["low"] }]), ["c"]);
    assert.deepEqual(ids([{ field: "label", op: "anyOf", value: ["l1"] }]), ["a"]);
    assert.deepEqual(ids([{ field: "label", op: "isEmpty" }]).includes("a"), false);
    assert.deepEqual(ids([{ field: "duration", op: "gte", value: 120 }]), ["b"]);
    assert.deepEqual(ids([{ field: "name", op: "contains", value: "B" }]), ["b"]);
    assert.deepEqual(ids([{ field: "cf:c1", op: "anyOf", value: ["o1"] }]), ["f"]);
    assert.deepEqual(ids([{ field: "cf:c3", op: "gt", value: 4 }]), ["f"]);
    // A task without the field never passes a comparison.
    assert.deepEqual(ids([{ field: "cf:c3", op: "lt", value: 100 }]), ["f"]);
  });

  test("any-groups, rule match and reminders", () => {
    assert.deepEqual(ids([{ match: "any", rules: [{ field: "overdue", op: "is", value: true }, { field: "blocked", op: "is", value: true }] }]), ["a", "c"]);
    assert.deepEqual(ids([{ field: "overdue", op: "is", value: true }, { field: "blocked", op: "is", value: true }], { ruleMatch: "any" }), ["a", "c"]);
    assert.deepEqual(ids([{ field: "planned", op: "in", value: "today" }], { showReminders: true }), ["r"]);
  });

  test("bad rules from an older or newer app are dropped, not fatal", () => {
    assert.deepEqual(normalizeRules([{ field: "nope", op: "in" }, { field: "deadline", op: "teleport" }, null, { field: "overdue", op: "is", value: true }]), [
      { field: "overdue", op: "is", value: true },
    ]);
    assert.deepEqual(normalizeRules("junk"), []);
  });
});

describe("sorting, limits and groups", () => {
  const ctx = queryContext(tasks, "UTC", NOW);
  test("empty values sort last either way", () => {
    const order = (sortBy, sortDirection) =>
      [...tasks].filter((item) => item.kind === "task").sort((a, b) => compareTasks(a, b, { sortBy, sortDirection }, ctx)).map((item) => item.id);
    assert.deepEqual(order("deadline", "asc").slice(0, 3), ["d", "a", "b"]);
    assert.deepEqual(order("deadline", "desc").slice(0, 3), ["b", "a", "d"]);
    assert.deepEqual(order("priority", "desc").slice(0, 3), ["b", "a", "c"]);
  });

  test("a view runs filter, sort and limit", () => {
    const view = {
      id: "v", name: "v", dataMode: "task", renderMode: "list", groupFields: [], groupSortDirection: "asc", groupValueOrders: {},
      sortBy: "deadline", sortDirection: "asc", selectedWorkspaceIds: [], selectedStatusIds: [], columnOrder: [],
      showCompleted: false, rules: [{ field: "deadline", op: "isNotEmpty" }], limit: 1,
    };
    assert.equal(filtersFromView(view).rules.length, 1);
    assert.deepEqual(runView(tasks, view, { timeZone: "UTC", now: NOW }).map((item) => item.id), ["a"]);
  });

  test("date buckets and labels group in their natural order", () => {
    assert.deepEqual(bucketGroupLabels(tasks[0], "deadline", ctx), ["Overdue"]);
    assert.deepEqual(bucketGroupLabels(tasks[1], "deadline", ctx), ["This week"]);
    assert.deepEqual(bucketGroupLabels(tasks[2], "deadline", ctx), ["No deadline"]);
    assert.deepEqual(bucketGroupLabels(tasks[0], "label", ctx), ["bug"]);
    assert.ok(bucketGroupRank("deadline", "Overdue") < bucketGroupRank("deadline", "Today"));
    assert.ok(bucketGroupRank("deadline", "Later") < bucketGroupRank("deadline", "No deadline"));
    assert.equal(bucketGroupLabels(tasks[0], "project", ctx), undefined);
  });
});

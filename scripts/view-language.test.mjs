import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { describeView, readViewQuery, readingIsListing, viewNoun } from "../packages/contract/src/viewLanguage.ts";

const TODAY = "2026-10-14"; // a Wednesday
const vocab = {
  workspaces: [
    { id: "w1", name: "Home" },
    { id: "w2", name: "Work" },
  ],
  projects: [
    { id: "p1", name: "Timely" },
    { id: "p2", name: "Website launch" },
  ],
  statuses: [
    { id: "s1", name: "To Do" },
    { id: "s2", name: "In Progress" },
    { id: "s3", name: "Done" },
    { id: "s4", name: "In Progress" },
  ],
  stages: [{ id: "g1", name: "Review" }],
  labels: [
    { id: "l1", name: "bug" },
    { id: "l2", name: "ui" },
  ],
  customFields: [
    { id: "c1", name: "Type", type: "select", options: { options: [{ id: "o1", value: "Feature" }, { id: "o2", value: "Chore" }] } },
    { id: "c2", name: "Billable", type: "boolean", options: { options: [] } },
    { id: "c3", name: "Points", type: "number", options: { options: [] } },
  ],
};

const read = (query) => readViewQuery(query, vocab, { today: TODAY });
const chips = (query) => describeView(read(query).view, vocab).map((chip) => chip.label);

describe("readViewQuery", () => {
  test("reads the screenshot's search as tasks with a deadline, soonest first", () => {
    const reading = read("show task deadline");
    assert.deepEqual(reading.view.rules, [{ field: "deadline", op: "isNotEmpty" }]);
    assert.equal(reading.view.sortBy, "deadline");
    assert.equal(reading.view.sortDirection, "asc");
    assert.equal(reading.view.showCompleted, false);
    assert.equal(reading.leftover.length, 0);
    assert.ok(readingIsListing(reading));
    assert.equal(reading.name, "Deadlines");
  });

  test("dates bind to the field they follow or lead", () => {
    assert.deepEqual(read("tasks due this week").view.rules, [{ field: "deadline", op: "in", value: "thisWeek" }]);
    assert.deepEqual(read("this week's deadlines").view.rules, [{ field: "deadline", op: "in", value: "thisWeek" }]);
    assert.deepEqual(read("created last month").view.rules, [{ field: "createdAt", op: "in", value: "lastMonth" }]);
    assert.deepEqual(read("deadline before friday").view.rules, [{ field: "deadline", op: "before", value: "2026-10-16" }]);
    assert.deepEqual(read("due by end of month").view.rules, [{ field: "deadline", op: "onOrBefore", value: "2026-10-31" }]);
    assert.deepEqual(read("due in the next 3 days").view.rules, [{ field: "deadline", op: "in", value: "next:3" }]);
    assert.deepEqual(read("due between oct 20 and oct 25").view.rules, [{ field: "deadline", op: "between", value: "2026-10-20", to: "2026-10-25" }]);
    assert.deepEqual(read("started this month").view.rules, [{ field: "startDate", op: "in", value: "thisMonth" }]);
  });

  test("a date with no field means due or planned then", () => {
    assert.deepEqual(read("show me tasks for tomorrow").view.rules, [
      { match: "any", rules: [{ field: "deadline", op: "in", value: "tomorrow" }, { field: "planned", op: "in", value: "tomorrow" }] },
    ]);
  });

  test("completed work includes done tasks and sorts by when it was done", () => {
    const reading = read("what did I complete last week");
    assert.deepEqual(reading.view.rules, [{ field: "completedAt", op: "in", value: "lastWeek" }]);
    assert.equal(reading.view.showCompleted, true);
    assert.equal(reading.view.sortBy, "completedAt");
    assert.equal(viewNoun(read("done tasks").view), "Done tasks");
  });

  test("the person's names: workspaces, projects, labels, stages, statuses, custom fields", () => {
    assert.deepEqual(read("urgent bugs in Home due this week as a board").view.rules, [
      { field: "deadline", op: "in", value: "thisWeek" },
      { field: "priority", op: "anyOf", value: ["Urgent"] },
      { field: "workspace", op: "anyOf", value: ["w1"] },
      { field: "label", op: "anyOf", value: ["l1"] },
    ]);
    assert.equal(read("urgent bugs in Home due this week as a board").view.renderMode, "kanban");
    assert.deepEqual(read("in progress tasks").view.rules, [{ field: "status", op: "anyOf", value: ["s2", "s4"] }]);
    assert.deepEqual(read("status done").view.rules, [{ field: "status", op: "anyOf", value: ["s3"] }]);
    assert.deepEqual(read("tasks in review stage").view.rules, [{ field: "stage", op: "anyOf", value: ["g1"] }]);
    assert.deepEqual(read("tasks in work workspace").view.rules, [{ field: "workspace", op: "anyOf", value: ["w2"] }]);
    assert.deepEqual(read("not in Home").view.rules, [{ field: "workspace", op: "noneOf", value: ["w1"] }]);
    assert.deepEqual(read("tasks about website launch").view.rules, [{ field: "project", op: "anyOf", value: ["p2"] }]);
    assert.deepEqual(read("feature type billable tasks").view.rules, [
      { field: "cf:c1", op: "anyOf", value: ["o1"] },
      { field: "cf:c2", op: "is", value: true },
    ]);
    assert.deepEqual(read("points over 3").view.rules, [{ field: "cf:c3", op: "gt", value: 3 }]);
    assert.deepEqual(read("tasks without labels").view.rules, [{ field: "label", op: "isEmpty" }]);
  });

  test("a plain word is not taken for a name that is also a word", () => {
    // "work" is a workspace here, but "show work" means work in general.
    assert.deepEqual(read("show work").view.rules, []);
  });

  test("states, flags, sizes and priority", () => {
    assert.deepEqual(read("overdue or due today").view.rules, [
      { match: "any", rules: [{ field: "deadline", op: "in", value: "today" }, { field: "overdue", op: "is", value: true }] },
    ]);
    assert.deepEqual(read("blocked tasks or blocking").view.rules, [
      { match: "any", rules: [{ field: "blocked", op: "is", value: true }, { field: "blocking", op: "is", value: true }] },
    ]);
    assert.deepEqual(read("not overdue").view.rules, [{ field: "overdue", op: "is", value: false }]);
    assert.deepEqual(read("unscheduled work").view.rules, [{ field: "scheduled", op: "is", value: false }]);
    assert.deepEqual(read("quick wins").view.rules, [{ field: "duration", op: "lte", value: 30 }]);
    assert.deepEqual(read("tasks longer than 2 hours").view.rules, [{ field: "duration", op: "gt", value: 120 }]);
    assert.deepEqual(read("no estimate").view.rules, [{ field: "duration", op: "isEmpty" }]);
    assert.deepEqual(read("high priority and above").view.rules, [{ field: "priority", op: "gte", value: "High" }]);
    assert.deepEqual(read("high or urgent tasks").view.rules, [{ field: "priority", op: "anyOf", value: ["High", "Urgent"] }]);
    assert.deepEqual(read("no priority").view.rules, [{ field: "priority", op: "isEmpty" }]);
    assert.deepEqual(read("deep work").view.rules, [{ field: "effort", op: "anyOf", value: ["deep"] }]);
    assert.deepEqual(read("untouched for 2 weeks").view.rules, [{ field: "updatedAt", op: "before", value: "-14" }]);
    assert.deepEqual(read("tasks not updated in 30 days").view.rules, [{ field: "updatedAt", op: "before", value: "-30" }]);
    assert.deepEqual(read("repeating tasks").view.rules, [{ field: "recurring", op: "is", value: true }]);
    assert.deepEqual(read("tasks with checklists").view.rules, [{ field: "hasChecklist", op: "is", value: true }]);
  });

  test("sorts, groups, layouts and limits", () => {
    const grouped = read("deadlines this week or overdue grouped by project then by priority").view;
    assert.deepEqual(grouped.groupFields, ["project", "priority"]);
    const sorted = read("sorted by priority then deadline").view;
    assert.equal(sorted.sortBy, "priority");
    assert.equal(sorted.sortDirection, "desc");
    assert.equal(sorted.thenSortBy, "deadline");
    assert.equal(read("newest first").view.sortBy, "createdAt");
    assert.equal(read("newest first").view.sortDirection, "desc");
    assert.deepEqual(read("tasks by project").view.groupFields, ["project"]);
    assert.equal(read("tasks by deadline").view.sortBy, "deadline");
    const top = read("top 5 longest tasks").view;
    assert.equal(top.limit, 5);
    assert.equal(top.sortBy, "duration");
    assert.equal(top.sortDirection, "desc");
    assert.equal(read("as a timeline").view.renderMode, "gantt");
    assert.equal(read("show my projects").view.dataMode, "project");
    assert.equal(read("reminders this week").view.showReminders, true);
  });

  test("everything includes done work", () => {
    assert.equal(read("everything in Timely").view.showCompleted, true);
  });

  test("making a view: the intent and its name", () => {
    const reading = read("new view called Quick wins: quick tasks with no deadline sorted by priority");
    assert.equal(reading.createView, true);
    assert.equal(reading.name, "Quick wins");
    assert.deepEqual(reading.view.rules, [
      { field: "duration", op: "lte", value: 30 },
      { field: "deadline", op: "isEmpty" },
    ]);
    const board = read("new board for Timely by stage");
    assert.equal(board.createView, true);
    assert.equal(board.view.renderMode, "kanban");
    assert.deepEqual(board.view.groupFields, ["stage"]);
    assert.equal(read('make a view named "Errands" for chores').name, "Errands");
  });

  test("words it cannot place become a mentions filter", () => {
    const reading = read("show tasks for the dentist");
    assert.deepEqual(reading.leftover, ["dentist"]);
    assert.deepEqual(reading.view.rules, [{ field: "text", op: "contains", value: "dentist" }]);
    assert.deepEqual(read('tasks mentioning "API keys"').view.rules, [{ field: "text", op: "contains", value: "API keys" }]);
  });

  test("a bare name or a single word is not a listing for search", () => {
    assert.equal(readingIsListing(read("Timely")), false);
    assert.equal(readingIsListing(read("dentist")), false);
    assert.equal(readingIsListing(read("overdue")), true);
    assert.equal(readingIsListing(read("show Timely")), true);
  });

  test("chips read back in words", () => {
    assert.deepEqual(chips("show task deadline"), ["Has a deadline", "Open only", "Soonest deadline first"]);
    assert.deepEqual(chips("show me tasks for tomorrow"), ["Due or planned tomorrow", "Open only", "Soonest deadline first"]);
    assert.ok(chips("urgent bugs in Home").includes("Workspace: Home"));
    assert.ok(chips("urgent bugs in Home").includes("Label bug"));
  });
});

import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

// dashboard.ts imports its siblings without an extension, as the apps'
// bundlers allow; teach Node's loader the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

const {
  adjustPomodoro,
  advancePomodoro,
  completionStreak,
  completionsByDay,
  computeCard,
  defaultDashboard,
  defaultQuery,
  fitQuery,
  highlightFacts,
  initialPomodoro,
  normalizeDashboard,
  pomodoroLength,
  pomodoroRemaining,
  pomodoroSettings,
  priorityMatrix,
  resolveRange,
  timeProgress,
  weekStart,
  CARD_TEMPLATES,
} = await import("../packages/contract/src/dashboard.ts");

// Thursday 8 Oct 2026, mid-morning UTC.
const now = new Date("2026-10-08T10:00:00Z");
const ctx = { now, timeZone: "UTC" };

function task(id, extra = {}) {
  return {
    id,
    name: `Task ${id}`,
    description: "",
    duration: 60,
    kind: "task",
    deadline: null,
    startDate: null,
    scheduledOn: null,
    completedAt: null,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    userId: "u",
    projectId: null,
    statusId: null,
    priorityLevel: null,
    workspaceId: "w1",
    scheduleId: null,
    stageId: null,
    blockedById: null,
    ...extra,
  };
}

const data = {
  tasks: [
    task("a", { deadline: "2026-10-01", priorityLevel: "High", projectId: "p1" }),
    task("b", { deadline: "2026-10-09", priorityLevel: "low" }),
    task("c", { completedAt: "2026-10-06T12:00:00Z", priorityLevel: "Urgent", projectId: "p1" }),
    task("d", { completedAt: "2026-10-07T12:00:00Z", actualMinutes: 90 }),
    task("e", { completedAt: "2026-09-30T12:00:00Z" }),
    task("r", { kind: "reminder" }),
  ],
  projects: [
    {
      id: "p1",
      title: "Launch",
      description: "",
      statusId: null,
      deadline: null,
      startDate: null,
      completedAt: null,
      priorityLevel: null,
      color: null,
      doesHaveStages: false,
      workspaceId: "w1",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ],
  workspaces: [{ id: "w1", name: "Personal", color: "#000", userId: "u", createdAt: "", updatedAt: "" }],
};

describe("ranges", () => {
  test("weeks start on Monday", () => {
    assert.equal(weekStart("2026-10-08"), "2026-10-05");
    assert.equal(weekStart("2026-10-05"), "2026-10-05");
    assert.equal(weekStart("2026-10-11"), "2026-10-05");
  });

  test("presets resolve to inclusive day windows", () => {
    assert.deepEqual(resolveRange({ preset: "thisWeek" }, "2026-10-08"), { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(resolveRange({ preset: "last7" }, "2026-10-08"), { from: "2026-10-02", to: "2026-10-08" });
    assert.deepEqual(resolveRange({ preset: "lastMonth" }, "2026-03-15"), { from: "2026-02-01", to: "2026-02-28" });
    assert.equal(resolveRange({ preset: "all" }, "2026-10-08"), null);
    assert.deepEqual(resolveRange({ preset: "custom", from: "2026-10-10", to: "2026-10-01" }, "2026-10-08"), {
      from: "2026-10-01",
      to: "2026-10-10",
    });
  });
});

describe("computeCard", () => {
  test("counts open work and leaves reminders out", () => {
    const result = computeCard({ ...defaultQuery("tasks"), filters: { state: "open" } }, data, ctx);
    assert.equal(result.kind, "number");
    assert.equal(result.value, 2);
  });

  test("compares this week's completions with last week", () => {
    const result = computeCard(
      { ...defaultQuery("tasks"), filters: { state: "done" }, dateField: "completedAt", range: { preset: "thisWeek" }, compare: true },
      data,
      ctx,
    );
    assert.equal(result.value, 2);
    assert.equal(result.previous, 1);
  });

  test("overdue list follows the shared Overdue rule", () => {
    const result = computeCard(
      { ...defaultQuery("tasks"), display: "list", filters: { state: "open", overdue: true }, sort: { field: "deadline", dir: "asc" } },
      data,
      ctx,
    );
    assert.equal(result.kind, "list");
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ["a"],
    );
    assert.equal(result.rows[0].subtitle, "Launch · High");
  });

  test("groups by priority in priority order and normalises case", () => {
    const result = computeCard({ ...defaultQuery("tasks"), display: "bar", groupBy: "priority", filters: { state: "all" } }, data, ctx);
    assert.deepEqual(
      result.points.map((point) => [point.label, point.value]),
      [
        ["Urgent", 1],
        ["High", 1],
        ["Low", 1],
        ["None", 2],
      ],
    );
  });

  test("time series fill empty days inside the range", () => {
    const result = computeCard(
      { ...defaultQuery("tasks"), display: "line", groupBy: "day", dateField: "completedAt", filters: { state: "done" }, range: { preset: "last7" } },
      data,
      ctx,
    );
    assert.equal(result.temporal, true);
    assert.equal(result.points.length, 7);
    assert.deepEqual(
      result.points.map((point) => point.value),
      [0, 0, 0, 0, 1, 1, 0],
    );
  });

  test("tracked hours sum actual minutes", () => {
    const result = computeCard({ ...defaultQuery("tasks"), measure: "tracked", filters: { state: "done" } }, data, ctx);
    assert.equal(result.unit, "hours");
    assert.equal(result.value, 1.5);
  });

  test("completion progress reads done out of everything in scope", () => {
    const result = computeCard({ ...defaultQuery("tasks"), display: "progress", progress: "completion", filters: { state: "open" } }, data, ctx);
    assert.equal(result.kind, "progress");
    assert.equal(result.value, 3);
    assert.equal(result.target, 5);
  });

  test("statuses with the same name in two workspaces group together", () => {
    const tasks = [
      task("s1", { statusId: "st_a", status: { id: "st_a", name: "Todo" } }),
      task("s2", { statusId: "st_b", status: { id: "st_b", name: "todo " } }),
      task("s3", { statusId: "st_c", status: { id: "st_c", name: "Done" } }),
    ];
    const result = computeCard({ ...defaultQuery("tasks"), display: "bar", groupBy: "status", filters: { state: "all" } }, { tasks }, ctx);
    assert.deepEqual(
      result.points.map((point) => [point.label, point.value]),
      [
        ["Todo", 2],
        ["Done", 1],
      ],
    );
  });

  test("pies fold the tail into Other", () => {
    const many = Array.from({ length: 10 }, (_, index) => task(`t${index}`, { projectId: `p${index}`, project: { id: `p${index}`, title: `P${index}` } }));
    const result = computeCard({ ...defaultQuery("tasks"), display: "pie", groupBy: "project", limit: 5 }, { tasks: many }, ctx);
    assert.equal(result.points.length, 5);
    assert.equal(result.points.at(-1).label, "Other (6)");
    assert.equal(result.points.at(-1).value, 6);
  });
});

describe("fitQuery", () => {
  test("line charts group by time and drop measures a source lacks", () => {
    const fitted = fitQuery({ ...defaultQuery("docs"), display: "line", measure: "estimate", groupBy: "status" });
    assert.equal(fitted.groupBy, "day");
    assert.equal(fitted.measure, "count");
  });

  test("every template is already a fitted query", () => {
    for (const template of CARD_TEMPLATES) {
      assert.deepEqual(fitQuery(template.query), template.query, template.id);
    }
  });
});

describe("layout", () => {
  test("null gives the default layout", () => {
    assert.deepEqual(normalizeDashboard(null), defaultDashboard());
  });

  test("drops unknown and duplicate cards and clamps sizes", () => {
    const layout = normalizeDashboard({
      version: 1,
      cards: [
        { id: "x", type: "pomodoro", w: 40, h: 0 },
        { id: "x", type: "notes", w: 4, h: 3 },
        { id: "y", type: "hologram", w: 4, h: 3 },
        { id: "z", type: "custom", w: 4, h: 3 },
      ],
    });
    assert.equal(layout.cards.length, 1);
    assert.equal(layout.cards[0].w, 12);
    assert.equal(layout.cards[0].h, 3);
    assert.equal(layout.cards[0].settings.focus, 25);
  });
});

describe("built-in helpers", () => {
  test("streak counts yesterday's run until today has a completion", () => {
    const counts = completionsByDay(data.tasks, "UTC");
    assert.deepEqual(completionStreak(counts, "2026-10-08"), { current: 2, best: 2 });
    assert.deepEqual(completionStreak(counts, "2026-10-10"), { current: 0, best: 2 });
  });

  test("priority matrix splits by importance and urgency", () => {
    const matrix = priorityMatrix(data.tasks, "2026-10-08", 3);
    assert.deepEqual(
      matrix.do.map((t) => t.id),
      ["a"],
    );
    assert.deepEqual(
      matrix.quick.map((t) => t.id),
      ["b"],
    );
  });

  test("highlight facts count the week, deadlines and the Inbox", () => {
    const facts = highlightFacts(
      {
        tasks: [
          task("late", { deadline: "2026-10-01" }),
          task("soon", { deadline: "2026-10-09" }),
          task("someday"),
          task("tue", { completedAt: "2026-10-06T12:00:00Z" }),
          task("wed1", { completedAt: "2026-10-07T09:00:00Z" }),
          task("wed2", { completedAt: "2026-10-07T15:00:00Z" }),
          task("thu", { completedAt: "2026-10-08T08:00:00Z" }),
          task("lastwed", { completedAt: "2026-09-30T12:00:00Z" }),
          task("note", { kind: "inbox" }),
        ],
        inbox: [task("old", { kind: "inbox", createdAt: "2026-10-01T09:00:00Z" }), task("new", { kind: "inbox", createdAt: "2026-10-07T09:00:00Z" })],
      },
      ctx,
    );
    assert.deepEqual(
      Object.fromEntries(facts.map((fact) => [fact.id, fact.text])),
      {
        done_week: "Finished 4 tasks in the last 7 days, up from 1 the 7 days before.",
        streak: "Current streak: 3 days in a row with something finished (best: 3).",
        overdue: "1 open task is past the deadline, the oldest by 7 days.",
        due_week: "1 open task is due in the next 7 days.",
        open: "3 open tasks in all; 1 without a deadline.",
        busiest_day: "Over the last 4 weeks you finished the most on Wednesdays (3 of 5 tasks).",
        inbox: "2 items in the Inbox; 1 waiting 3 days or more.",
      },
    );
    assert.deepEqual(highlightFacts({}, ctx).map((fact) => fact.id), ["done_week"]);
  });

  test("time progress reads the working day", () => {
    const progress = timeProgress(now, { start: "09:00", end: "17:00" }, "UTC");
    assert.equal(progress.day, 1 / 8);
    assert.equal(progress.dayLabel, "7h 0m left");
  });

  test("pomodoro cycles focus, breaks and a long break", () => {
    const settings = pomodoroSettings({ rounds: 2 });
    let state = initialPomodoro();
    state = advancePomodoro(state, settings, true, "2026-10-08", 0);
    assert.equal(state.phase, "short");
    state = advancePomodoro(state, settings, true, "2026-10-08", 0);
    assert.equal(state.phase, "focus");
    state = advancePomodoro(state, settings, true, "2026-10-08", 0);
    assert.equal(state.phase, "long");
    assert.equal(state.history["2026-10-08"], 2);
    state = advancePomodoro(state, settings, false, "2026-10-08", 0);
    assert.equal(state.phase, "focus");
    assert.equal(state.round, 0);
  });

  test("plus and minus change only the running phase", () => {
    const settings = pomodoroSettings({});
    const idle = initialPomodoro();
    assert.equal(adjustPomodoro(idle, settings, 60_000, 0), idle);

    let state = { ...idle, endsAt: 25 * 60_000 };
    state = adjustPomodoro(state, settings, 60_000, 0);
    assert.equal(pomodoroRemaining(state, settings, 0), 26 * 60_000);
    assert.equal(pomodoroLength(state, settings), 26 * 60_000);

    // Taking time off never ends the phase on its own.
    state = adjustPomodoro(state, settings, -60 * 60_000, 0);
    assert.equal(pomodoroRemaining(state, settings, 0), 1000);

    // The next phase starts from its own length again.
    state = advancePomodoro(state, settings, true, "2026-10-08", 0);
    assert.equal(pomodoroLength(state, settings), 5 * 60_000);

    const paused = adjustPomodoro({ ...idle, remaining: 10 * 60_000 }, settings, 60_000, 0);
    assert.equal(paused.remaining, 11 * 60_000);
    assert.equal(paused.endsAt, null);
  });
});

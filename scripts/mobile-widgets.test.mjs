import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

// The shared contract imports its siblings without an extension, as the
// apps' bundlers allow; teach Node's loader the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

const { BUILTIN_CARDS, defaultDashboard } = await import("../packages/contract/src/dashboard.ts");
const { CLOCK_LOCAL_LIMITS, POMODORO_LOCAL_LIMITS, cardWidgetModel, clockWidgetModel, pomodoroLocalFrom, pomodoroWidgetModel, todayModel, widgetChoices } = await import("../apps/mobile/lib/widgets/model.ts");
const { clockChange, isLocalTap, optimisticModel, parseWidgetAction } = await import("../apps/mobile/lib/widgets/actions.ts");
const { SHARED_MS, sharedLoads } = await import("../apps/mobile/lib/widgets/sharedLoads.ts");
const { clockState, initialPomodoro, pomodoroRemaining, pomodoroSettings } = await import("../packages/contract/src/dashboard.ts");
const catalog = (await import("../apps/mobile/lib/widgets/catalog.json", { with: { type: "json" } })).default;

const now = new Date("2026-10-15T09:00:00Z");
const task = (id, extra = {}) => ({ id, name: `Task ${id}`, priority: "medium", createdAt: "2026-10-10T00:00:00Z", ...extra });
const data = {
  tasks: [
    task("a", { deadline: "2026-10-10", completedAt: null }),
    task("b", { completedAt: "2026-10-15T08:00:00Z" }),
    task("c", { completedAt: "2026-10-14T08:00:00Z" }),
    task("d"),
  ],
  inbox: [task("i1", { inbox: true })],
  projects: [],
  workspaces: [],
  docs: [],
  sheets: [],
  reminders: [],
  events: [],
};
const input = { now, data, timeZone: "UTC", scheme: "timelymobile", today: null, focusSessions: [], pomodoros: [] };

function assertDrawable(model, label) {
  assert.ok(model.title, `${label}: title`);
  assert.match(model.uri, /^timelymobile:\/\//, `${label}: uri`);
  const content = model.value || model.rows?.length || model.bars?.length || model.ring || model.meters?.length || model.note || model.buttons?.length || model.empty || model.caption;
  assert.ok(content, `${label}: something to draw`);
  for (const row of model.rows ?? []) if (row.uri) assert.match(row.uri, /^timelymobile:\/\//, `${label}: row uri`);
}

describe("home screen widgets", () => {
  test("every built-in Dashboard card becomes a widget", () => {
    for (const info of BUILTIN_CARDS) {
      const card = { id: `w_${info.type}`, type: info.type, w: info.w, h: info.h, settings: info.settings ? { ...info.settings } : undefined };
      assertDrawable(cardWidgetModel(card, input), info.type);
    }
  });

  test("every card on the default board, custom ones included, becomes a widget", () => {
    for (const card of defaultDashboard().cards) assertDrawable(cardWidgetModel(card, input), card.id);
  });

  test("a custom number card shows the same count as the Dashboard", () => {
    const card = defaultDashboard().cards.find((c) => c.id === "default_overdue_count");
    const model = cardWidgetModel(card, input);
    assert.equal(model.value, "1");
  });

  test("a custom list card links each row to its task", () => {
    const card = defaultDashboard().cards.find((c) => c.id === "default_overdue");
    const model = cardWidgetModel(card, input);
    assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].uri, "timelymobile://tasks/a");
  });

  test("sheet and doc cards from the Card workshop draw the picked cells and doc", () => {
    const base = defaultDashboard().cards.find((c) => c.id === "default_open");
    const card = (extra) => ({ ...base, query: { ...base.query, ...extra } });
    const columns = [
      { id: "cat", name: "Category", width: 120, type: "text" },
      { id: "spent", name: "Spent", width: 100, type: "number" },
    ];
    const rows = [
      { id: "h", cells: { cat: "Category", spent: "Spent" } },
      { id: "r1", cells: { cat: "Rent", spent: "1400" } },
      { id: "r2", cells: { cat: "Food", spent: "300" } },
      { id: "t", cells: { cat: "Total", spent: "=SUM(B2:B3)" } },
    ];
    const sheet = { id: "s1", title: "Budget", columns, rows, merges: [], tabs: [{ id: "tab", name: "Budget", columns, rows, merges: [] }], archivedAt: null };
    const t = (text) => ({ type: "text", text });
    const item = (text, checked) => ({ type: "taskItem", attrs: { checked }, content: [{ type: "paragraph", content: [t(text)] }] });
    const doc = { id: "d1", content: { type: "doc", content: [{ type: "taskList", content: [item("Passport", true), item("Jacket", false)] }] } };
    const files = { sheets: { s1: sheet }, docs: { d1: doc } };

    const value = cardWidgetModel(card({ sheet: { sheetId: "s1", tabId: "tab", range: "B4", view: "value" } }), { ...input, files });
    assert.equal(value.value, "1700");
    assert.equal(value.uri, "timelymobile://sheets/s1");

    const table = cardWidgetModel(card({ sheet: { sheetId: "s1", tabId: "tab", range: "A2:B3", view: "table" } }), { ...input, files });
    assert.deepEqual(table.rows.map((row) => [row.title, ...row.cells]), [["Rent", "1400"], ["Food", "300"]]);
    assert.equal(table.scroll, true);

    const checklist = cardWidgetModel(card({ doc: { docId: "d1", view: "checklist" } }), { ...input, files });
    assert.equal(checklist.value, "1/2");
    assert.deepEqual(checklist.rows.map((row) => [row.title, row.done]), [["Passport", true], ["Jacket", false]]);
    assert.equal(checklist.uri, "timelymobile://docs/d1");

    const page = cardWidgetModel(card({ doc: { docId: "d1", view: "page" } }), { ...input, files });
    assert.equal(page.note, "☑ Passport\n☐ Jacket");

    // Offline or deleted: say so instead of showing a wrong number.
    const gone = cardWidgetModel(card({ sheet: { sheetId: "s1", range: "B4", view: "value" } }), input);
    assert.equal(gone.value, undefined);
    assert.ok(gone.empty);
    assert.ok(cardWidgetModel(card({ doc: { docId: "d1", view: "page" } }), input).empty);
  });

  test("Inbox zero counts open Inbox items and offers Capture", () => {
    const model = cardWidgetModel({ id: "z", type: "inboxZero", w: 3, h: 2 }, input);
    assert.equal(model.value, "1");
    assert.equal(model.buttons[0].uri, "timelymobile://shortcut/capture");
  });

  test("Today shows done out of planned and what's next", () => {
    const today = {
      items: [
        { kind: "task", taskId: "t1", title: "Write report", start: "2026-10-15T10:00:00Z", end: "2026-10-15T11:00:00Z", allDay: false },
        { kind: "event", eventId: "e1", title: "Standup", start: "2026-10-15T08:30:00Z", end: "2026-10-15T09:15:00Z", allDay: false },
        { kind: "event", eventId: "e0", title: "Breakfast", start: "2026-10-15T07:00:00Z", end: "2026-10-15T07:30:00Z", allDay: false },
      ],
      completedToday: [{ id: "done1" }],
      todayFocus: [],
      overdue: [],
      focusing: null,
      pausedFocus: null,
    };
    const model = todayModel({ ...input, today });
    assert.equal(model.value, "1/2");
    assert.deepEqual(
      model.rows.map((row) => [row.title, row.meta]),
      [
        ["Standup", "Now"],
        ["Write report", "10:00 AM"],
      ],
    );
    assert.equal(model.rows[1].uri, "timelymobile://tasks/t1");
  });

  test("Today without data asks to open the app", () => {
    assert.ok(todayModel(input).empty);
  });

  test("the card picker lists your own cards as yours", () => {
    const choices = widgetChoices(defaultDashboard().cards);
    assert.ok(choices.find((c) => c.id === "default_open").custom);
    assert.equal(choices.find((c) => c.id === "default_today").custom, false);
  });

  test("the widget catalog: a picker for cards, sizes that fit a launcher grid", () => {
    const names = catalog.WIDGETS.map((w) => w.name);
    assert.deepEqual(names, ["TimelyCard", "TimelyToday", "TimelyPomodoro", "TimelyTimer", "TimelyQuickAdd"]);
    // Pomodoro and Timer belong to no card: nothing to pick when they are added.
    for (const widget of catalog.WIDGETS.slice(1)) assert.equal(widget.widgetFeatures, undefined, widget.name);
    assert.equal(catalog.WIDGETS[0].widgetFeatures, "reconfigurable");
    for (const widget of catalog.WIDGETS) assert.match(widget.previewImage, /^\.\/assets\/widgets\/.+\.png$/);
  });

  test("no fixed update period: the app and the background refresh redraw widgets, so Android never wakes the phone for them", () => {
    for (const widget of catalog.WIDGETS) assert.equal(widget.updatePeriodMillis, undefined, widget.name);
  });
});

describe("widget loads", () => {
  test("widgets drawn together share each request", async () => {
    let time = 0;
    let calls = 0;
    const { shared } = sharedLoads(() => time);
    const tasks = () => {
      calls++;
      return Promise.resolve(["task"]);
    };
    const [a, b] = await Promise.all([shared("tasks", tasks), shared("tasks", tasks)]);
    time += 1_000;
    const c = await shared("tasks", tasks);
    assert.deepEqual([a, b, c], [["task"], ["task"], ["task"]]);
    assert.equal(calls, 1);
  });

  test("a request goes stale, and a change drops it", async () => {
    let time = 0;
    let calls = 0;
    const { shared, forget } = sharedLoads(() => time);
    const load = () => Promise.resolve(++calls);
    await shared("config", load);
    time += SHARED_MS;
    assert.equal(await shared("config", load), 2);
    forget();
    assert.equal(await shared("config", load), 3);
  });

  test("a failed request isn't kept, so the next widget tries again", async () => {
    let calls = 0;
    const { shared } = sharedLoads(() => 0);
    const load = () => (++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("ok"));
    assert.equal(await shared("today", load), undefined);
    assert.equal(await shared("today", load), "ok");
  });
});

describe("widgets that work on the home screen", () => {
  const t0 = now.getTime();
  const pomodoro = { id: "pomo", type: "pomodoro", w: 3, h: 2 };
  const ops = (model) => model.buttons.map((button) => button.action?.op ?? button.action?.kind);

  test("an idle pomodoro shows the round's length and starts from the widget", () => {
    const model = cardWidgetModel(pomodoro, input);
    const length = pomodoroRemaining(initialPomodoro(), pomodoroSettings(undefined), t0);
    assert.equal(model.timer.running, false);
    assert.equal(model.timer.base, t0 + length);
    assert.deepEqual(ops(model), ["start", "skip"]);
    assert.equal(model.buttons[0].label, "Start focus");
  });

  test("a pomodoro switches phase and changes its length from the widget", () => {
    const model = cardWidgetModel({ ...pomodoro, settings: { focus: 30 } }, input);
    assert.deepEqual(
      model.tabs.map((tab) => [tab.label, tab.selected, tab.action.phase]),
      [["Focus", true, "focus"], ["Short", false, "short"], ["Long", false, "long"]],
    );
    assert.equal(model.value, "30:00");
    assert.deepEqual([model.stepper.minus?.by, model.stepper.plus?.by], [-1, 1]);
    // At the shortest length there's nothing to take off.
    const shortest = cardWidgetModel({ ...pomodoro, settings: { focus: 1 } }, input);
    assert.equal(shortest.stepper.minus, undefined);
    assert.deepEqual(parseWidgetAction({ kind: "pomodoroPhase", cardId: "pomo", phase: "long" }), { kind: "pomodoroPhase", cardId: "pomo", phase: "long" });
    assert.deepEqual(parseWidgetAction({ kind: "pomodoroStep", cardId: "pomo", by: -1 }), { kind: "pomodoroStep", cardId: "pomo", by: -1 });
    assert.equal(parseWidgetAction({ kind: "pomodoroPhase", cardId: "pomo", phase: "nap" }), null);
  });

  test("a waiting break can be skipped back to focus from the widget", () => {
    const model = cardWidgetModel(pomodoro, { ...input, pomodoros: [{ cardId: "pomo", phase: "short", endsAt: null, leftMs: 300_000, active: false }] });
    assert.equal(model.buttons[0].label, "Start break");
    assert.deepEqual(ops(model), ["start", "skip"]);
  });

  test("a running pomodoro ticks down to its end, with Pause and Skip", () => {
    const endsAt = t0 + 10 * 60_000;
    const model = cardWidgetModel(pomodoro, { ...input, pomodoros: [{ cardId: "pomo", phase: "focus", endsAt, leftMs: 600_000, active: true, taskName: "Report" }] });
    assert.deepEqual(model.timer, { base: endsAt, countDown: true, running: true });
    assert.equal(model.value, "10:00");
    assert.equal(model.caption, "Focus · Report");
    assert.deepEqual(ops(model), ["pause", "skip"]);
  });

  test("a paused pomodoro holds its time, with Resume and Reset", () => {
    const model = cardWidgetModel(pomodoro, { ...input, pomodoros: [{ cardId: "pomo", phase: "short", endsAt: null, leftMs: 90_000, active: true }] });
    assert.equal(model.timer.running, false);
    assert.equal(model.value, "1:30");
    assert.deepEqual(ops(model), ["start", "reset"]);
  });

  test("a waiting pomodoro with its own lengths changes phase and length on the phone alone", () => {
    const local = { ...pomodoroLocalFrom({ focus: 30 }), phase: "short" };
    const model = pomodoroWidgetModel({ cardId: "widget-7", title: "Pomodoro", uri: "timelymobile://", settings: undefined, now: t0, pomodoros: [], local });
    // Tabs and −/+ are local taps; the figure is a token the phone fills in.
    assert.deepEqual(model.tabs.map((tab) => [tab.selected, tab.action]), [[false, { set: "phase", value: "focus" }], [true, { set: "phase", value: "short" }], [false, { set: "phase", value: "long" }]]);
    assert.deepEqual([model.stepper.minus, model.stepper.plus], [{ step: "short", by: -1 }, { step: "short", by: 1 }]);
    assert.ok(model.tabs.every((tab) => isLocalTap(tab.action)));
    assert.equal(model.value, "5:00");
    assert.equal(model.valueText, "{{short:clock}}");
    assert.equal(model.timer, undefined);
    // Start is the one tap that reaches the app.
    assert.deepEqual(model.buttons[0].action, { kind: "pomodoro", cardId: "widget-7", op: "start" });
    assert.deepEqual(POMODORO_LOCAL_LIMITS.short, [1, 60]);
  });

  test("a running pomodoro's tabs and −/+ go back to the app", () => {
    const local = pomodoroLocalFrom(undefined);
    const pomodoros = [{ cardId: "widget-7", phase: "focus", endsAt: t0 + 60_000, leftMs: 60_000, active: true }];
    const model = pomodoroWidgetModel({ cardId: "widget-7", title: "Pomodoro", uri: "timelymobile://", settings: undefined, now: t0, pomodoros, local });
    assert.ok(model.tabs.every((tab) => !isLocalTap(tab.action)));
    assert.equal(model.stepper.plus.kind, "pomodoroStep");
    assert.equal(model.valueText, undefined);
    assert.equal(model.timer.running, true);
  });

  test("an idle Timer widget picks stopwatch or timer, and the timer's length, on the phone", () => {
    const idle = clockState(undefined);
    const timer = clockWidgetModel({ cardId: "widget-8", title: "Timer", uri: "timelymobile://", state: idle, now: t0, local: { mode: "timer", minutes: 12 } });
    assert.deepEqual(timer.tabs.map((tab) => [tab.label, tab.selected, tab.action]), [["Stopwatch", false, { set: "mode", value: "stopwatch" }], ["Timer", true, { set: "mode", value: "timer" }]]);
    assert.deepEqual(timer.stepper.plus, { step: "minutes", by: 1 });
    assert.equal(timer.value, "12:00");
    assert.equal(timer.valueText, "{{minutes:clock}}");
    assert.deepEqual(CLOCK_LOCAL_LIMITS.minutes, [1, 600]);
    const stopwatch = clockWidgetModel({ cardId: "widget-8", title: "Timer", uri: "timelymobile://", state: idle, now: t0, local: { mode: "stopwatch", minutes: 12 } });
    assert.equal(stopwatch.stepper, undefined);
    assert.deepEqual(ops(stopwatch), ["start"]);
    // Running, it names what it runs and the tabs make way.
    const running = clockWidgetModel({ cardId: "widget-8", title: "Timer", uri: "timelymobile://", state: { ...idle, mode: "timer", minutes: 12, startedAt: t0 - 60_000 }, now: t0, local: { mode: "stopwatch", minutes: 3 } });
    assert.equal(running.title, "Timer");
    assert.equal(running.tabs, undefined);
    assert.equal(running.value, "11:00");
  });

  test("a stopwatch counts up from when it would read 0:00", () => {
    const settings = { mode: "stopwatch", startedAt: t0 - 30_000, elapsed: 15_000, laps: [] };
    const model = cardWidgetModel({ id: "sw", type: "clock", w: 3, h: 2, settings }, input);
    assert.deepEqual(model.timer, { base: t0 - 45_000, countDown: false, running: true });
    assert.deepEqual(ops(model), ["pause", "lap"]);
  });

  test("a timer that ran out says so and offers Restart", () => {
    const settings = { mode: "timer", minutes: 1, startedAt: t0 - 120_000, elapsed: 0 };
    const model = cardWidgetModel({ id: "tm", type: "clock", w: 3, h: 2, settings }, input);
    assert.equal(model.caption, "Time's up");
    assert.equal(model.timer, undefined);
    assert.deepEqual(ops(model), ["start", "reset"]);
  });

  test("stopwatch and timer buttons change the card the way the Dashboard does", () => {
    const idle = clockState({ mode: "stopwatch" });
    assert.deepEqual(clockChange(idle, "start", t0), { startedAt: t0, done: false });
    const running = clockState({ mode: "stopwatch", startedAt: t0 - 5_000, elapsed: 1_000 });
    assert.deepEqual(clockChange(running, "pause", t0), { elapsed: 6_000, startedAt: null });
    assert.deepEqual(clockChange(running, "lap", t0), { laps: [6_000] });
    assert.equal(clockChange(running, "start", t0), null);
    assert.equal(clockChange(idle, "pause", t0), null);
    const ranOut = clockState({ mode: "timer", minutes: 1, startedAt: t0 - 120_000 });
    assert.deepEqual(clockChange(ranOut, "start", t0), { startedAt: t0, elapsed: 0, done: false });
  });

  test("habits, Top 3, task lists and doc checklists tick in place", () => {
    const habits = cardWidgetModel({ id: "h", type: "habits", w: 3, h: 3, settings: { habits: [{ id: "walk", name: "Walk" }], log: {} } }, input);
    assert.deepEqual(habits.rows[0].toggle, { kind: "habit", cardId: "h", habitId: "walk" });
    assert.equal(habits.rows[0].uri, undefined);

    const top = cardWidgetModel({ id: "t3", type: "topThree", w: 3, h: 3, settings: { day: "2026-10-15", taskIds: ["b", "d"] } }, input);
    assert.deepEqual(top.rows.map((row) => row.toggle), [
      { kind: "task", taskId: "b", done: false },
      { kind: "task", taskId: "d", done: true },
    ]);

    const list = cardWidgetModel(defaultDashboard().cards.find((c) => c.id === "default_overdue"), input);
    assert.deepEqual(list.rows[0].toggle, { kind: "task", taskId: "a", done: true });
    assert.equal(list.rows[0].uri, "timelymobile://tasks/a");
  });

  test("a Today task occurrence ticks just that day", () => {
    const today = {
      items: [{ kind: "taskOccurrence", taskId: "r1", originalStart: "2026-10-15T10:00:00Z", title: "Stretch", start: "2026-10-15T10:00:00Z", end: "2026-10-15T10:15:00Z", allDay: false }],
      completedToday: [],
      todayFocus: [],
      overdue: [],
    };
    const model = todayModel({ ...input, today });
    assert.deepEqual(model.rows[0].toggle, { kind: "task", taskId: "r1", done: true, originalStart: "2026-10-15T10:00:00Z" });
  });

  test("a sheet counter steps from the widget unless its cell is a formula", () => {
    const base = defaultDashboard().cards.find((c) => c.id === "default_open");
    const columns = [{ id: "n", name: "Glasses", width: 100, type: "number" }];
    const rows = [{ id: "r1", cells: { n: "3" } }, { id: "r2", cells: { n: "=A1*2" } }];
    const sheet = { id: "s1", title: "Water", columns, rows, merges: [], tabs: [{ id: "tab", name: "Water", columns, rows, merges: [] }], archivedAt: null };
    const card = (range) => ({ ...base, id: "cnt", query: { ...base.query, sheet: { sheetId: "s1", tabId: "tab", range, view: "counter", step: 1 } } });
    const files = { sheets: { s1: sheet } };
    const counter = cardWidgetModel(card("A1"), { ...input, files });
    assert.deepEqual(counter.buttons.map((button) => button.action), [
      { kind: "counter", cardId: "cnt", by: -1 },
      { kind: "counter", cardId: "cnt", by: 1 },
    ]);
    assert.equal(cardWidgetModel(card("A2"), { ...input, files }).buttons, undefined);
  });

  test("a doc checklist row toggles its own checkbox", () => {
    const base = defaultDashboard().cards.find((c) => c.id === "default_open");
    const item = (text, checked) => ({ type: "taskItem", attrs: { checked }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const doc = { id: "d1", content: { type: "doc", content: [{ type: "taskList", content: [item("Milk", false), item("Eggs", true)] }] } };
    const model = cardWidgetModel({ ...base, id: "dc", query: { ...base.query, doc: { docId: "d1", view: "checklist" } } }, { ...input, files: { docs: { d1: doc } } });
    assert.deepEqual(model.rows.map((row) => row.toggle), [
      { kind: "docCheck", cardId: "dc", index: 0, checked: true },
      { kind: "docCheck", cardId: "dc", index: 1, checked: false },
    ]);
  });

  test("a tap redraws at once: the row flips and the tally moves", () => {
    const model = {
      title: "Habits",
      uri: "timelymobile://dashboard",
      value: "1/2",
      rows: [
        { title: "Walk", done: false, toggle: { kind: "habit", cardId: "h", habitId: "walk" } },
        { title: "Read", done: true, toggle: { kind: "habit", cardId: "h", habitId: "read" } },
      ],
    };
    const next = optimisticModel(model, { kind: "habit", cardId: "h", habitId: "walk" });
    assert.equal(next.value, "2/2");
    assert.equal(next.rows[0].done, true);
    const task = { title: "T", uri: "x://", rows: [{ title: "A", done: false, toggle: { kind: "task", taskId: "a", done: true } }] };
    assert.deepEqual(optimisticModel(task, { kind: "task", taskId: "a", done: true }).rows[0].toggle, { kind: "task", taskId: "a", done: false });
    assert.equal(optimisticModel({ title: "C", uri: "x://", value: "3" }, { kind: "counter", cardId: "c", by: 1 }).value, "4");
  });

  test("actions survive Android's flat bundle and junk is ignored", () => {
    const actions = [
      { kind: "pomodoro", cardId: "p", op: "skip" },
      { kind: "clock", cardId: "c", op: "lap" },
      { kind: "habit", cardId: "h", habitId: "walk" },
      { kind: "task", taskId: "t", done: false },
      { kind: "task", taskId: "t", done: true, originalStart: "2026-10-15T10:00:00Z" },
      { kind: "counter", cardId: "c", by: -2 },
      { kind: "docCheck", cardId: "d", index: 0, checked: true },
    ];
    for (const action of actions) assert.deepEqual(parseWidgetAction({ ...action }), action);
    assert.equal(parseWidgetAction({ kind: "pomodoro", cardId: "p", op: "explode" }), null);
    assert.equal(parseWidgetAction({ kind: "counter", cardId: "c", by: 0 }), null);
    assert.equal(parseWidgetAction(null), null);
  });
});

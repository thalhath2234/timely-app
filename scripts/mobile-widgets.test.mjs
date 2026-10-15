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
const { cardWidgetModel, todayModel, widgetChoices } = await import("../apps/mobile/lib/widgets/model.ts");
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
    assert.deepEqual(names, ["TimelyCard", "TimelyToday", "TimelyQuickAdd"]);
    assert.equal(catalog.WIDGETS[0].widgetFeatures, "reconfigurable");
    for (const widget of catalog.WIDGETS) assert.match(widget.previewImage, /^\.\/assets\/widgets\/.+\.png$/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { LIVE_ACTIONS, clock, liveKey, liveModel } from "../apps/mobile/lib/live/liveModel.ts";
import { NOTIFICATION_CATEGORIES, categoryFor, freshAlerts, notificationBody } from "../apps/mobile/lib/notificationCategories.ts";

const NOW = Date.parse("2026-10-15T09:00:00Z");
const base = { now: NOW, chats: [], focusing: null, pomodoros: [], scheduling: false, scheme: "timelymobile" };

describe("live notification", () => {
  test("nothing running means no notification", () => {
    assert.equal(liveModel(base), null);
    assert.equal(liveModel({ ...base, chats: [{ id: "c1", title: "Plan", status: "done" }] }), null);
  });

  test("a busy Assistant run leads with Open chat and Stop", () => {
    const model = liveModel({ ...base, chats: [{ id: "c1", title: "Plan my week", status: "running", phase: "apply" }] });
    assert.equal(model.title, "Plan my week");
    assert.equal(model.text, "Saving your changes…");
    assert.equal(model.progress.indeterminate, true);
    assert.equal(model.uri, "timelymobile://assistant?chatId=c1");
    assert.deepEqual(
      model.actions.map((action) => action.id),
      ["open", LIVE_ACTIONS.stopRun],
    );
    assert.deepEqual(model.actions[1].data, { chatId: "c1" });
  });

  test("focus counts up from when it started", () => {
    const model = liveModel({ ...base, focusing: { id: "t1", name: "Write report", focusStartedAt: "2026-10-15T08:30:00Z" } });
    assert.equal(model.title, "Write report");
    assert.deepEqual(model.chronometer, { base: Date.parse("2026-10-15T08:30:00Z") });
    assert.equal(model.actions[0].id, LIVE_ACTIONS.stopFocus);
  });

  test("a pomodoro on the focused task replaces the focus item", () => {
    const model = liveModel({
      ...base,
      focusing: { id: "t1", name: "Write report", focusStartedAt: "2026-10-15T08:30:00Z" },
      pomodoros: [{ cardId: "p1", phase: "focus", endsAt: NOW + 10 * 60_000, leftMs: 600_000, taskId: "t1", taskName: "Write report" }],
    });
    assert.deepEqual(model.chronometer, { base: NOW + 10 * 60_000, countDown: true });
    assert.equal(model.bigText, undefined);
    assert.deepEqual(
      model.actions.map((action) => action.label),
      ["Pause", "Take a break"],
    );
  });

  test("a paused pomodoro shows the time left as a chip and offers Resume", () => {
    const model = liveModel({ ...base, pomodoros: [{ cardId: "p1", phase: "short", endsAt: null, leftMs: 125_000 }] });
    assert.equal(model.chip, "2:05");
    assert.equal(model.chronometer, undefined);
    assert.equal(model.actions[0].id, LIVE_ACTIONS.resumePomodoro);
    assert.equal(model.actions[1].label, "Skip break");
  });

  test("a pomodoro shows how far through the phase it is on the progress bar", () => {
    const running = liveModel({
      ...base,
      pomodoros: [{ cardId: "p1", phase: "focus", endsAt: NOW + 10 * 60_000, leftMs: 600_000, totalMs: 25 * 60_000 }],
    });
    assert.deepEqual(running.progress, { max: 1000, value: 600 });
    assert.match(running.text, /^Ends \d/);
    const paused = liveModel({ ...base, pomodoros: [{ cardId: "p1", phase: "short", endsAt: null, leftMs: 60_000, totalMs: 5 * 60_000 }] });
    assert.deepEqual(paused.progress, { max: 1000, value: 800 });
    const unknown = liveModel({ ...base, pomodoros: [{ cardId: "p1", phase: "short", endsAt: null, leftMs: 60_000 }] });
    assert.equal(unknown.progress, undefined);
  });

  test("several things running list one line each when expanded", () => {
    const model = liveModel({
      ...base,
      chats: [
        { id: "c1", title: "A", status: "running" },
        { id: "c2", title: "B", status: "queued" },
      ],
      scheduling: true,
    });
    assert.equal(model.subText, "2 assistant runs");
    assert.equal(model.bigText.split("\n").length, 3);
  });

  test("the change key ignores a ticking focus clock but not a new run", () => {
    const one = liveModel({ ...base, focusing: { id: "t1", name: "X", focusStartedAt: "2026-10-15T08:30:00Z" } });
    const later = liveModel({ ...base, now: NOW + 5000, focusing: { id: "t1", name: "X", focusStartedAt: "2026-10-15T08:30:00Z" } });
    assert.equal(liveKey(one), liveKey(later));
    const withRun = liveModel({
      ...base,
      focusing: { id: "t1", name: "X", focusStartedAt: "2026-10-15T08:30:00Z" },
      chats: [{ id: "c", title: "Y", status: "running" }],
    });
    assert.notEqual(liveKey(one), liveKey(withRun));
  });

  test("clock formats minutes and hours", () => {
    assert.equal(clock(65_000), "1:05");
    assert.equal(clock(3_725_000), "1:02:05");
  });
});

describe("notification quick actions", () => {
  test("Android shows at most three buttons per notification", () => {
    for (const [id, actions] of Object.entries(NOTIFICATION_CATEGORIES)) {
      assert.ok(actions.length >= 1 && actions.length <= 3, id);
      assert.equal(new Set(actions.map((action) => action.id)).size, actions.length, id);
    }
  });

  test("a smart suggestion's next step comes first with a ✦", () => {
    const id = categoryFor({ category: "overdue", data: { suggest: "extend" } });
    assert.equal(id, "timely_overdue_extend");
    assert.equal(NOTIFICATION_CATEGORIES[id][0].title, "✦ Deadline +1 week");
    assert.equal(categoryFor({ category: "overdue", data: { suggest: "unknown" } }), "timely_overdue");
  });

  test("missed blocks of repeating tasks never offer to move the series", () => {
    assert.equal(categoryFor({ category: "missed", data: { recurring: true, suggest: "move" } }), "timely_missed_recurring");
    assert.ok(!NOTIFICATION_CATEGORIES.timely_missed_recurring.some((action) => action.id === "triage:move"));
  });

  test("Assistant alerts: review, finished (with Reply) and failed (with Try again)", () => {
    assert.equal(categoryFor({ category: "agent", data: { status: "approval" } }), "timely_agent_review");
    assert.equal(categoryFor({ category: "agent", data: { status: "done" } }), "timely_agent_done");
    assert.equal(categoryFor({ category: "agent", data: { status: "failed" } }), "timely_agent_failed");
    const reply = NOTIFICATION_CATEGORIES.timely_agent_done.find((action) => action.id === "reply");
    assert.ok(reply?.textInput);
    assert.ok(NOTIFICATION_CATEGORIES.timely_agent_failed.some((action) => action.id === "retry"));
  });

  test("unknown categories get no buttons", () => {
    assert.equal(categoryFor({ category: "something" }), null);
    assert.equal(categoryFor({ category: "suggestion", data: { action: "nope" } }), null);
  });

  test("bodies say what to do next", () => {
    assert.equal(notificationBody({ category: "agent", data: { status: "approval" } }), "Needs your review before anything changes.");
    assert.equal(
      notificationBody({ category: "suggestion", body: "These could use a date:", data: { items: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] } }),
      "These could use a date: A, B, C and 1 more",
    );
    assert.equal(notificationBody({ category: "start", body: "Reminder" }), "");
  });
});

describe("server alerts fetched by the phone", () => {
  const item = (id, minutesAgo, extra = {}) => ({ id, createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(), category: "overdue", ...extra });

  test("the first look covers the last two hours", () => {
    const fresh = freshAlerts([item("a", 30), item("b", 200)], { since: null, ids: [] }, NOW);
    assert.deepEqual(
      fresh.map((x) => x.id),
      ["a"],
    );
  });

  test("skips alerts already shown, reminders and snoozed ones", () => {
    const fresh = freshAlerts(
      [item("a", 5), item("b", 5, { category: "reminder" }), item("c", 5, { snoozedUntil: new Date(NOW + 60_000).toISOString() }), item("d", 5)],
      { since: new Date(NOW - 10 * 60_000).toISOString(), ids: ["a"] },
      NOW,
    );
    assert.deepEqual(
      fresh.map((x) => x.id),
      ["d"],
    );
  });

  test("allows a minute of clock skew before the last look", () => {
    const seen = { since: new Date(NOW).toISOString(), ids: [] };
    assert.equal(freshAlerts([item("a", 0.5)], seen, NOW).length, 1);
    assert.equal(freshAlerts([item("b", 2)], seen, NOW).length, 0);
  });
});

describe("live notification battery", () => {
  const loop = readFileSync(new URL("../apps/mobile/lib/live/liveActivity.ts", import.meta.url), "utf8");

  test("checks the server every minute unless an Assistant run is working", () => {
    assert.match(loop, /const IDLE_TICK_MS = 60_000;/);
    assert.match(loop, /const BUSY_TICK_MS = 6_000;/);
  });

  test("a run started during a long wait ends the wait", () => {
    assert.match(loop, /if \(!wasBusy && busy\(\)\) return;/);
  });
});

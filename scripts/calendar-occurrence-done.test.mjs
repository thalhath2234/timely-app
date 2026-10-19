import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { calendarItemDone, withOccurrenceDone } from "../packages/contract/src/calendar.ts";

// A daily reminder: one item per day, keyed by the occurrence's original start.
const day = (originalStart, completedAt = null) => ({
  kind: "taskOccurrence",
  taskId: "tsk_trash",
  originalStart,
  completedAt,
  task: { id: "tsk_trash", completedAt: null },
});

describe("calendarItemDone", () => {
  test("an occurrence is done only when that day was ticked off", () => {
    assert.equal(calendarItemDone(day("2026-10-19T21:00:00Z")), false);
    assert.equal(calendarItemDone(day("2026-10-19T21:00:00Z", "2026-10-19T22:10:00Z")), true);
  });

  // Today and the calendar must agree: a stray completedAt on the series row
  // does not tick every day off.
  test("a series marked done as a whole does not mark its days done", () => {
    const item = { ...day("2026-10-19T21:00:00Z"), task: { id: "tsk_trash", completedAt: "2026-10-18T22:00:00Z" } };
    assert.equal(calendarItemDone(item), false);
  });

  test("a one-off task's block is done with its task", () => {
    assert.equal(calendarItemDone({ kind: "task", completedAt: null, task: { completedAt: "2026-10-19T10:00:00Z" } }), true);
  });
});

describe("withOccurrenceDone", () => {
  const items = [day("2026-10-19T21:00:00Z"), day("2026-10-20T21:00:00Z"), { ...day("2026-10-19T21:00:00Z"), taskId: "tsk_other" }];

  test("ticks only the matching day of the matching task", () => {
    const next = withOccurrenceDone(items, "tsk_trash", "2026-10-19T21:00:00Z", "2026-10-19T22:10:00Z");
    assert.deepEqual(
      next.map((item) => item.completedAt),
      ["2026-10-19T22:10:00Z", null, null],
    );
  });

  test("matches the same instant written in another zone", () => {
    const next = withOccurrenceDone(items, "tsk_trash", "2026-10-20T06:00:00+09:00", "2026-10-19T22:10:00Z");
    assert.equal(next[0].completedAt, "2026-10-19T22:10:00Z");
  });

  test("unticks a day", () => {
    const ticked = withOccurrenceDone(items, "tsk_trash", "2026-10-19T21:00:00Z", "2026-10-19T22:10:00Z");
    assert.equal(withOccurrenceDone(ticked, "tsk_trash", "2026-10-19T21:00:00Z", null)[0].completedAt, null);
  });
});

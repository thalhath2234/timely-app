import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  dateInZone,
  isOverdue,
  isUnscheduled,
  todayInZone,
} from "../packages/contract/src/workStatus.ts";

function localDate(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

describe("dateInZone", () => {
  // 02:30 UTC on Oct 7 is still Oct 6 evening in Los Angeles and already
  // Oct 7 afternoon in Auckland.
  const instant = new Date("2026-10-07T02:30:00Z");

  test("uses the calendar date of the zone, not the device", () => {
    assert.equal(dateInZone(instant, "UTC"), "2026-10-07");
    assert.equal(dateInZone(instant, "America/Los_Angeles"), "2026-10-06");
    assert.equal(dateInZone(instant, "Pacific/Auckland"), "2026-10-07");
    assert.equal(dateInZone(instant, "Pacific/Kiritimati"), "2026-10-07");
    assert.equal(
      dateInZone(new Date("2026-10-07T23:30:00Z"), "Asia/Kolkata"),
      "2026-10-08",
    );
  });

  test("falls back to the device zone without a usable zone", () => {
    const expected = localDate(instant);
    assert.equal(dateInZone(instant), expected);
    assert.equal(dateInZone(instant, ""), expected);
    assert.equal(dateInZone(instant, null), expected);
    assert.equal(dateInZone(instant, "Not/AZone"), expected);
  });

  test("todayInZone is dateInZone of now", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    assert.equal(todayInZone("UTC", now), "2026-03-01");
    assert.equal(todayInZone(undefined, now), localDate(now));
  });
});

describe("isOverdue", () => {
  const work = { kind: "task", deadline: "2026-10-06", completedAt: null };

  test("a deadline date before today is Overdue", () => {
    assert.equal(isOverdue(work, "2026-10-07"), true);
  });

  test("a deadline today or later is not", () => {
    assert.equal(isOverdue(work, "2026-10-06"), false);
    assert.equal(isOverdue(work, "2026-10-05"), false);
  });

  test("the same deadline flips with the zone's date", () => {
    // 2026-10-07T02:30Z: Overdue in Auckland, not yet in Los Angeles.
    const now = new Date("2026-10-07T02:30:00Z");
    const task = { kind: "task", deadline: "2026-10-06" };
    assert.equal(isOverdue(task, todayInZone("Pacific/Auckland", now)), true);
    assert.equal(isOverdue(task, todayInZone("America/Los_Angeles", now)), false);
  });

  test("timestamp deadlines count by their date text, like the server", () => {
    assert.equal(
      isOverdue({ kind: "task", deadline: "2026-10-06T23:00:00Z" }, "2026-10-07"),
      true,
    );
    assert.equal(
      isOverdue({ kind: "task", deadline: "2026-10-07T01:00:00Z" }, "2026-10-07"),
      false,
    );
  });

  test("completed Work, Reminders, Inbox items and undated Work never are", () => {
    const today = "2026-10-07";
    assert.equal(isOverdue({ ...work, completedAt: "2026-10-06T10:00:00Z" }, today), false);
    assert.equal(isOverdue({ ...work, kind: "reminder" }, today), false);
    assert.equal(isOverdue({ ...work, kind: "inbox" }, today), false);
    assert.equal(isOverdue({ kind: "task", deadline: null }, today), false);
    assert.equal(isOverdue({ kind: "task", deadline: "" }, today), false);
    assert.equal(isOverdue({ kind: "task" }, today), false);
  });
});

describe("isUnscheduled", () => {
  // Wednesday 2026-10-07 12:00 UTC.
  const now = new Date("2026-10-07T12:00:00Z");
  const block = (start, end) => ({ start, end });
  const work = (extra = {}) => ({ kind: "task", completedAt: null, blocks: [], ...extra });

  test("Work with no Block and no ping is Unscheduled", () => {
    assert.equal(isUnscheduled(work(), "UTC", now), true);
    assert.equal(isUnscheduled(work({ blocks: null }), "UTC", now), true);
  });

  test("a Block today makes it Scheduled", () => {
    const t = work({ blocks: [block("2026-10-07T09:00:00Z", "2026-10-07T10:00:00Z")] });
    assert.equal(isUnscheduled(t, "UTC", now), false);
  });

  test("a Block on another date does not, past or future", () => {
    const past = work({ blocks: [block("2026-10-06T09:00:00Z", "2026-10-06T10:00:00Z")] });
    const future = work({ blocks: [block("2026-10-08T09:00:00Z", "2026-10-08T10:00:00Z")] });
    assert.equal(isUnscheduled(past, "UTC", now), true);
    assert.equal(isUnscheduled(future, "UTC", now), true);
  });

  test("a Block running across today counts", () => {
    const t = work({ blocks: [block("2026-10-06T22:00:00Z", "2026-10-07T01:00:00Z")] });
    assert.equal(isUnscheduled(t, "UTC", now), false);
    const spans = work({ blocks: [block("2026-10-06T22:00:00Z", "2026-10-08T01:00:00Z")] });
    assert.equal(isUnscheduled(spans, "UTC", now), false);
  });

  test("any Block at all no longer hides it: only today's matter", () => {
    const t = work({
      blocks: [
        block("2026-10-01T09:00:00Z", "2026-10-01T10:00:00Z"),
        block("2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z"),
      ],
    });
    assert.equal(isUnscheduled(t, "UTC", now), true);
  });

  test("today is the Working hours date, not the device or UTC date", () => {
    // 23:30 UTC Oct 7 is already Oct 8 in Auckland.
    const late = new Date("2026-10-07T23:30:00Z");
    const t = work({ blocks: [block("2026-10-08T01:00:00Z", "2026-10-08T02:00:00Z")] });
    assert.equal(isUnscheduled(t, "UTC", late), true);
    assert.equal(isUnscheduled(t, "Pacific/Auckland", late), false);
  });

  test("a scheduledOn ping today counts; one on another date does not", () => {
    assert.equal(isUnscheduled(work({ scheduledOn: "2026-10-07T15:00:00Z" }), "UTC", now), false);
    assert.equal(isUnscheduled(work({ scheduledOn: "2026-10-09T15:00:00Z" }), "UTC", now), true);
  });

  test("scheduledOn without a zone is wall time in the Working hours zone", () => {
    const naive = work({ scheduledOn: "2026-10-07T09:00" });
    assert.equal(isUnscheduled(naive, "America/Los_Angeles", now), false);
    assert.equal(isUnscheduled(work({ scheduledOn: "2026-10-07" }), "UTC", now), false);
    // Postgres style offsets parse too.
    const pg = work({ scheduledOn: "2026-10-07 09:00:00+00" });
    assert.equal(isUnscheduled(pg, "UTC", now), false);
  });

  test("completed Work, Reminders and Inbox items are never Unscheduled", () => {
    assert.equal(isUnscheduled(work({ completedAt: "2026-10-06T10:00:00Z" }), "UTC", now), false);
    assert.equal(isUnscheduled(work({ kind: "reminder" }), "UTC", now), false);
    assert.equal(isUnscheduled(work({ kind: "inbox" }), "UTC", now), false);
  });
});

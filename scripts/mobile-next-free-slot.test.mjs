import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { findNextFreeSlot } from "../apps/mobile/lib/nextFreeSlot.ts";

const slot = (start, end) => ({ start, end });

// The server returns the free Working hours (GET /schedule/free-time); the
// phone only picks the first gap a task fits into.
describe("findNextFreeSlot", () => {
  const now = new Date("2026-12-07T09:07:00Z");

  test("snaps up to the quarter hour inside the first gap", () => {
    const got = findNextFreeSlot({ now, durationMinutes: 30, slots: [slot("2026-12-07T09:00:00Z", "2026-12-07T10:00:00Z")] });
    assert.equal(got?.toISOString(), "2026-12-07T09:15:00.000Z");
  });

  test("skips gaps that are too short", () => {
    const got = findNextFreeSlot({
      now,
      durationMinutes: 60,
      slots: [slot("2026-12-07T09:00:00Z", "2026-12-07T09:45:00Z"), slot("2026-12-07T10:30:00Z", "2026-12-07T13:00:00Z")],
    });
    assert.equal(got?.toISOString(), "2026-12-07T10:30:00.000Z");
  });

  test("never starts in the past or before the gap", () => {
    const got = findNextFreeSlot({ now, durationMinutes: 30, slots: [slot("2026-12-08T09:00:00Z", "2026-12-08T17:00:00Z")] });
    assert.equal(got?.toISOString(), "2026-12-08T09:00:00.000Z");
  });

  test("is null when nothing fits", () => {
    assert.equal(findNextFreeSlot({ now, durationMinutes: 120, slots: [slot("2026-12-07T09:00:00Z", "2026-12-07T10:00:00Z")] }), null);
    assert.equal(findNextFreeSlot({ now, slots: [] }), null);
  });
});

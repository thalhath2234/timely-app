import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  eventHref,
  findEventItem,
  sameInstant,
  withTimeOfDay,
  withUntil,
} from "../apps/mobile/lib/eventOccurrence.ts";

// A weekly series shows up on the calendar as one item per date. The event
// screen must edit the date that was tapped, not the first one in the list.
const occurrence = (originalStart, start = originalStart) => ({
  kind: "eventOccurrence",
  eventId: "evt_1",
  originalStart,
  start,
});

describe("eventHref", () => {
  test("carries an occurrence's original start", () => {
    assert.equal(
      eventHref(occurrence("2026-10-28T09:00:00Z")),
      "/(app)/events/evt_1?occurrence=2026-10-28T09%3A00%3A00Z",
    );
  });

  test("a one-off event opens without a query", () => {
    assert.equal(eventHref({ kind: "event", eventId: "evt_2" }), "/(app)/events/evt_2");
  });
});

describe("findEventItem", () => {
  const items = [
    occurrence("2026-10-14T09:00:00Z"),
    occurrence("2026-10-21T09:00:00Z"),
    occurrence("2026-10-28T09:00:00Z", "2026-10-28T11:00:00Z"),
    { kind: "event", eventId: "evt_2" },
  ];

  test("picks the occurrence that was opened, whatever the offset", () => {
    assert.equal(findEventItem(items, "evt_1", "2026-10-28T10:00:00+01:00"), items[2]);
  });

  test("falls back to the event's first item without an occurrence", () => {
    assert.equal(findEventItem(items, "evt_1", undefined), items[0]);
    assert.equal(findEventItem(items, "evt_2", undefined), items[3]);
  });
});

test("sameInstant ignores missing values", () => {
  assert.equal(sameInstant(undefined, "2026-10-14T09:00:00Z"), false);
  assert.equal(sameInstant("2026-10-14T09:00:00Z", "2026-10-14T09:00:00.000Z"), true);
});

describe("withUntil", () => {
  test("ends the series one second before the cutoff and drops COUNT", () => {
    assert.equal(
      withUntil("FREQ=WEEKLY;BYDAY=WE;COUNT=10", new Date("2026-10-28T09:00:00Z")),
      "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028T085959Z",
    );
  });

  test("replaces an earlier UNTIL and strips the RRULE: prefix", () => {
    assert.equal(
      withUntil("RRULE:FREQ=DAILY;UNTIL=20270101T000000Z", new Date("2026-10-21T09:00:00Z")),
      "FREQ=DAILY;UNTIL=20261021T085959Z",
    );
  });
});

test("withTimeOfDay keeps the day and takes the time", () => {
  const result = withTimeOfDay(new Date(2026, 9, 14, 9, 0), new Date(2026, 9, 28, 15, 30));
  assert.deepEqual(
    [result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes()],
    [2026, 9, 14, 15, 30],
  );
});

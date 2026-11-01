import assert from "node:assert/strict";
import { register } from "node:module";
import test, { describe } from "node:test";

// inbox.ts imports its siblings without an extension, as the apps' bundlers
// allow; teach Node's loader the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);

const { inboxAge, inboxQueue, inboxSuggestionSummary, inboxSuggestionWords, skipInboxItem, INBOX_STALE_DAYS } = await import("../packages/contract/src/inbox.ts");

const now = new Date("2026-10-11T12:00:00Z");
const item = (id, createdAt) => ({ id, createdAt });

describe("inboxAge", () => {
  test("labels today, yesterday and older captures by calendar day", () => {
    assert.equal(inboxAge("2026-10-11T08:00:00Z", now, "UTC").label, "Today");
    assert.equal(inboxAge("2026-10-10T23:30:00Z", now, "UTC").label, "Yesterday");
    assert.deepEqual(inboxAge("2026-10-05T12:00:00Z", now, "UTC"), { days: 6, stale: true, label: "Waiting 6 days" });
  });

  test("is stale from the threshold on", () => {
    assert.equal(INBOX_STALE_DAYS, 3);
    assert.equal(inboxAge("2026-10-09T12:00:00Z", now, "UTC").stale, false);
    assert.equal(inboxAge("2026-10-08T12:00:00Z", now, "UTC").stale, true);
  });

  test("counts days in the given timezone", () => {
    // 23:30 UTC on Oct 10 is already Oct 11 in Auckland, the same day as
    // 05:00 UTC on Oct 11.
    const morning = new Date("2026-10-11T05:00:00Z");
    assert.equal(inboxAge("2026-10-10T23:30:00Z", morning, "Pacific/Auckland").label, "Today");
    assert.equal(inboxAge("2026-10-10T23:30:00Z", morning, "UTC").label, "Yesterday");
  });

  test("reads a bare date as the capture day in any timezone", () => {
    assert.equal(inboxAge("2026-10-11", now, "America/Los_Angeles").label, "Today");
    assert.equal(inboxAge("2026-10-10", now, "Pacific/Auckland").days, 2);
  });

  test("never goes negative and survives a bad timestamp", () => {
    assert.equal(inboxAge("2026-10-12T12:00:00Z", now, "UTC").days, 0);
    assert.equal(inboxAge("not a date", now, "UTC").days, 0);
  });
});

describe("inboxQueue", () => {
  const items = [
    item("new", "2026-10-11T09:00:00Z"),
    item("old", "2026-10-05T09:00:00Z"),
    item("mid", "2026-10-09T09:00:00Z"),
  ];

  test("puts the oldest capture up next and the rest newest first", () => {
    const { next, rest } = inboxQueue(items);
    assert.equal(next.id, "old");
    assert.deepEqual(rest.map((i) => i.id), ["new", "mid"]);
  });

  test("same-day captures keep the server's order", () => {
    const sameDay = [item("first", "2026-10-11"), item("second", "2026-10-11"), item("third", "2026-10-11")];
    const { next, rest } = inboxQueue(sameDay);
    assert.equal(next.id, "first");
    assert.deepEqual(rest.map((i) => i.id), ["third", "second"]);
  });

  test("skipped captures step aside", () => {
    const { next, rest } = inboxQueue(items, ["old"]);
    assert.equal(next.id, "mid");
    assert.deepEqual(rest.map((i) => i.id), ["new", "old"]);
  });

  test("an empty inbox has nothing up next", () => {
    assert.deepEqual(inboxQueue([]), { next: null, rest: [] });
  });
});

describe("skipInboxItem", () => {
  const items = [item("a", "2026-10-01T00:00:00Z"), item("b", "2026-10-02T00:00:00Z"), item("c", "2026-10-03T00:00:00Z")];

  test("adds to the skip list and forgets captures that left", () => {
    assert.deepEqual(skipInboxItem(items, ["gone"], "a"), ["a"]);
    assert.deepEqual(skipInboxItem(items, ["a"], "b"), ["a", "b"]);
  });

  test("starts over once every capture was skipped", () => {
    assert.deepEqual(skipInboxItem(items, ["a", "b"], "c"), []);
    assert.equal(inboxQueue(items, skipInboxItem(items, ["a", "b"], "c")).next.id, "a");
  });
});

describe("inboxSuggestionSummary", () => {
  test("reads a task suggestion as one line", () => {
    const summary = inboxSuggestionSummary(
      { kind: "task", duration: 45, dateRole: "deadline", date: "2026-10-30", priority: "High" },
      "Personal",
    );
    assert.equal(summary.line, "A 45 min task, deadline Fri, Oct 30, in Personal, high priority");
    assert.equal(summary.note, "");
  });

  test("reads a reminder with its time", () => {
    const summary = inboxSuggestionSummary({ kind: "reminder", dateRole: "reminder", date: "2026-10-12", time: "09:00" });
    assert.equal(summary.line, "A reminder for Mon, Oct 12 at 9 AM");
  });

  test("keeps only a note when there is no confident kind", () => {
    assert.deepEqual(inboxSuggestionSummary({ severalActions: true, duration: 30 }), {
      line: "",
      note: "It may be more than one task.",
      duplicates: [],
    });
    assert.equal(inboxSuggestionSummary({ kind: "task", duration: 90 }).line, "A 1 h 30 min task");
  });

  test("lists possible duplicates to open, never the capture itself", () => {
    const summary = inboxSuggestionSummary(
      {
        duplicates: [
          { id: "self", name: "renew my number card" },
          { id: "t1", name: "Renew My number card" },
          { id: "t2", name: "Renew passport" },
          { id: "t3", name: "Renew licence" },
        ],
      },
      undefined,
      "self",
    );
    assert.equal(summary.note, "");
    assert.deepEqual(
      summary.duplicates.map((item) => item.id),
      ["t1", "t2"],
    );
  });
});

describe("inboxSuggestionWords", () => {
  const listed = { name: "Call Bob by Friday", description: "", updatedAt: "2026-11-01T02:33:00Z" };
  const renamed = { name: "Call Bob by Monday", description: "", updatedAt: "2026-11-01T02:34:00Z" };

  test("a rename gives new words, so the suggestions are asked again", () => {
    const before = inboxSuggestionWords(listed, undefined);
    const after = inboxSuggestionWords(listed, renamed);
    assert.equal(before, "Call Bob by Friday\n");
    assert.equal(after, "Call Bob by Monday\n");
    assert.notEqual(after, before);
  });

  test("takes the newer copy, whichever list it came from", () => {
    assert.equal(inboxSuggestionWords(renamed, listed), "Call Bob by Monday\n");
    assert.equal(inboxSuggestionWords(undefined, renamed), "Call Bob by Monday\n");
    assert.equal(inboxSuggestionWords({ name: "Water the plants", description: "Balcony too" }), "Water the plants\nBalcony too");
  });

  test("is empty before either copy is loaded", () => {
    assert.equal(inboxSuggestionWords(undefined, undefined), "");
  });

  test("orders saves within one second by time, not by text", () => {
    // The server drops trailing zeros: .1 is later than .09, and a whole
    // second earlier than any fraction of it.
    const at = (name, updatedAt) => ({ name, description: "", updatedAt });
    assert.equal(inboxSuggestionWords(at("old", "2026-11-01T02:33:05.09Z"), at("new", "2026-11-01T02:33:05.1Z")), "new\n");
    assert.equal(inboxSuggestionWords(at("new", "2026-11-01T02:33:05.1Z"), at("old", "2026-11-01T02:33:05.09Z")), "new\n");
    assert.equal(inboxSuggestionWords(at("old", "2026-11-01T02:33:05Z"), at("new", "2026-11-01T02:33:05.5Z")), "new\n");
    assert.equal(
      inboxSuggestionWords(at("old", "2026-11-01T02:33:05.123456Z"), at("new", "2026-11-01T02:33:05.1234567Z")),
      "new\n",
    );
    // Another zone written out is still the same moment.
    assert.equal(inboxSuggestionWords(at("new", "2026-11-01T08:03:06+05:30"), at("old", "2026-11-01T02:33:05.9Z")), "new\n");
    // Equal times keep the list's copy, as before.
    assert.equal(inboxSuggestionWords(at("listed", "2026-11-01T02:33:05.5Z"), at("own", "2026-11-01T02:33:05.50Z")), "listed\n");
  });
});

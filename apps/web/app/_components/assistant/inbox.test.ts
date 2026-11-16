// Unfinished new-Bot drafts in the web inbox: the newest is a row of its own,
// the older ones fold into one "N unfinished Bots" row.
// Run: node --experimental-strip-types --test apps/web/app/_components/assistant/inbox.test.ts
import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error node runs this file directly and needs the .ts extension, which the web tsconfig refuses
import { OLDER_DRAFTS_ID, applyBotThreads, buildInbox, filterInbox, needsYouTotal, unfinishedWords } from "./inbox.ts";

const now = new Date("2026-11-16T12:00:00Z");
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

// Only the fields the inbox reads.
const draft = (id: string, minutesAgo: number, title = "New bot") =>
  ({
    id,
    kind: "bot_thread",
    draft: true,
    title,
    status: "idle",
    unread: false,
    updatedAt: iso(minutesAgo),
    parkedSteps: 0,
    pendingChanges: 0,
    reviewCards: 0,
    needsYou: true,
  }) as never;

test("the newest draft is its own row and the older ones fold into one summary row", () => {
  const inbox = buildInbox([], [], now, [draft("d1", 50), draft("d3", 5), draft("d2", 20), draft("d4", 90)]);
  assert.deepEqual(inbox.needs.map((i) => `${i.type}:${i.id}`), ["draft:d3"]);
  assert.deepEqual(inbox.recent.map((i) => `${i.type}:${i.id}`), [`drafts:${OLDER_DRAFTS_ID}`]);
  const summary = inbox.recent[0];
  assert.equal(summary.title, "3 unfinished Bots");
  assert.deepEqual(summary.type === "drafts" ? summary.drafts.map((d) => d.id) : [], ["d2", "d1", "d4"]);
});

test("fourteen abandoned drafts take two rows, and the summary adds nothing to the badge", () => {
  const threads = Array.from({ length: 14 }, (_, i) => draft(`d${i}`, i + 1));
  const inbox = buildInbox([], [], now, threads);
  assert.equal(inbox.needs.length + inbox.recent.length, 2);
  assert.equal(inbox.recent[0].title, "13 unfinished Bots");
  assert.equal(needsYouTotal([], [], now, threads), 1);
  assert.equal(unfinishedWords(1), "1 unfinished Bot");
});

test("applying the threads again gives the same inbox", () => {
  const threads = [draft("a", 1), draft("b", 2), draft("c", 3)];
  const once = buildInbox([], [], now, threads);
  assert.deepEqual(applyBotThreads(once, threads), once);
});

test("search matches inside the folded drafts and keeps only those", () => {
  const inbox = buildInbox([], [], now, [draft("a", 1, "Newest"), draft("b", 2, "Price of shoes"), draft("c", 3, "Weather")]);
  const found = filterInbox(inbox, "shoes");
  assert.deepEqual(found.needs, []);
  const row = found.recent[0];
  assert.equal(row.type === "drafts" ? row.drafts.length : -1, 1);
  assert.equal(row.title, "1 unfinished Bot");
});

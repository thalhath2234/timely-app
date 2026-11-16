// @ts-nocheck node runs this file directly (node:test, .ts import paths); the app's tsconfig has no node types
// Unfinished new-Bot drafts in the phone's inbox: the newest is a row of its own,
// the older ones fold into one "N unfinished Bots" row.
// Run: node --experimental-strip-types --test apps/mobile/components/assistant/inbox.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { OLDER_DRAFTS_ID, buildInbox, filterInbox, unfinishedWords, type InboxThread } from "./inbox.ts";

const now = new Date("2026-11-16T12:00:00Z");
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

const draft = (id: string, minutesAgo: number, title = "New Bot"): InboxThread => ({
  id,
  draft: true,
  title,
  unread: false,
  updatedAt: iso(minutesAgo),
  parkedSteps: 0,
  pendingChanges: 0,
  reviewCards: 0,
});

test("the newest draft is its own row and the older ones fold into one summary row", () => {
  const threads = [draft("d1", 50), draft("d3", 5), draft("d2", 20), draft("d4", 90)];
  const { needs, recent } = buildInbox([], [], threads, now);
  assert.deepEqual(needs, []);
  assert.deepEqual(
    recent.map((i) => `${i.type}:${i.id}`),
    ["draft:d3", `drafts:${OLDER_DRAFTS_ID}`],
  );
  const summary = recent[1];
  assert.equal(summary.type, "drafts");
  assert.equal(summary.title, "3 unfinished Bots");
  assert.deepEqual(summary.type === "drafts" ? summary.drafts.map((d) => d.id) : [], ["d2", "d1", "d4"]);
});

test("one draft stays a single row, two drafts fold one", () => {
  assert.deepEqual(buildInbox([], [], [draft("a", 1)], now).recent.map((i) => i.type), ["draft"]);
  const two = buildInbox([], [], [draft("a", 1), draft("b", 2)], now).recent;
  assert.deepEqual(two.map((i) => i.type), ["draft", "drafts"]);
  assert.equal(two[1].title, "1 unfinished Bot");
  assert.equal(unfinishedWords(14), "14 unfinished Bots");
});

test("fourteen abandoned drafts take two rows, never fourteen", () => {
  const threads = Array.from({ length: 14 }, (_, i) => draft(`d${i}`, i + 1));
  const { recent } = buildInbox([], [], threads, now);
  assert.equal(recent.length, 2);
  assert.equal(recent[1].title, "13 unfinished Bots");
});

test("the folded row never counts as needing the person", () => {
  const { needs } = buildInbox([], [], [draft("a", 1), draft("b", 2), draft("c", 3)], now);
  assert.equal(needs.length, 0);
});

test("search matches inside the folded drafts and keeps only those", () => {
  const threads = [draft("a", 1, "Newest"), draft("b", 2, "Price of shoes"), draft("c", 3, "Weather")];
  const found = filterInbox(buildInbox([], [], threads, now), "shoes");
  assert.deepEqual(found.recent.map((i) => i.id), [OLDER_DRAFTS_ID]);
  const row = found.recent[0];
  assert.equal(row.type === "drafts" ? row.drafts.length : -1, 1);
  assert.equal(row.title, "1 unfinished Bot");
  assert.deepEqual(filterInbox(buildInbox([], [], threads, now), "zzz").recent, []);
});

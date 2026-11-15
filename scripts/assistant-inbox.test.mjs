// The Assistant's Needs you list (apps/web/app/_components/assistant/inbox.ts):
// chats keep their rows, and a Bot thread that waits on a parked step, a
// one-tap change or a Review card puts its Bot (or a draft) there.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  BOT_NEEDS_WORDS,
  applyBotThreads,
  botNeedsLine,
  buildInbox,
  filterInbox,
  needsYouTotal,
  threadNeeds,
} from "../apps/web/app/_components/assistant/inbox.ts";

const now = new Date("2026-11-16T12:00:00Z");

const bot = (id, fields = {}) => ({
  id,
  name: `Bot ${id}`,
  description: "",
  status: "active",
  pauseReason: null,
  strikes: 0,
  health: { code: "ok" },
  latestAlert: null,
  suggestion: null,
  watches: [],
  updatedAt: "2026-11-10T09:00:00Z",
  ...fields,
});

const chat = (id, fields = {}) => ({
  id,
  title: `Chat ${id}`,
  status: "idle",
  unread: false,
  updatedAt: "2026-11-12T09:00:00Z",
  ...fields,
});

const thread = (botId, fields = {}) => ({
  id: `cht_${botId}`,
  kind: "bot_thread",
  botId,
  draft: false,
  title: `Bot ${botId}`,
  status: "idle",
  unread: false,
  updatedAt: "2026-11-15T09:00:00Z",
  parkedSteps: 0,
  pendingChanges: 0,
  reviewCards: 0,
  needsYou: false,
  ...fields,
});

const row = (list, id) => list.find((i) => i.id === id);

describe("threadNeeds", () => {
  test("a parked step comes first, then a one-tap change, then a Review card", () => {
    assert.equal(threadNeeds(thread("b", { parkedSteps: 1, pendingChanges: 1, reviewCards: 1, needsYou: true })).needs, "parked");
    assert.equal(threadNeeds(thread("b", { pendingChanges: 1, reviewCards: 1, needsYou: true })).needs, "change");
    assert.equal(threadNeeds(thread("b", { reviewCards: 2, needsYou: true })).needs, "review");
  });

  test("counts everything that waits, and is null when nothing does", () => {
    assert.equal(threadNeeds(thread("b", { parkedSteps: 2, reviewCards: 1, needsYou: true })).waiting, 3);
    assert.equal(threadNeeds(thread("b")), null);
  });
});

describe("Needs you rows for Bot threads", () => {
  test("each kind of wait gets plain words and opens the Bot's thread", () => {
    const threads = [
      thread("p", { parkedSteps: 1, needsYou: true }),
      thread("c", { pendingChanges: 1, needsYou: true }),
      thread("r", { reviewCards: 1, needsYou: true }),
    ];
    const inbox = buildInbox([], [bot("p"), bot("c"), bot("r")], now, threads);
    assert.equal(inbox.recent.length, 0);
    const words = Object.fromEntries(inbox.needs.map((i) => [i.id, botNeedsLine(i)]));
    assert.deepEqual(words, {
      p: "Waiting for your OK",
      c: "Change waiting for one tap",
      r: "Review a proposed change",
    });
    for (const id of ["p", "c", "r"]) {
      assert.equal(row(inbox.needs, id).href, `/assistant?bot=${id}&thread=1`);
    }
  });

  test("orders parked steps, then changes, then Review cards, ahead of other Bot reasons", () => {
    const alerted = bot("a", { latestAlert: { createdAt: "2026-11-16T08:00:00Z", feedback: null, held: null } });
    const inbox = buildInbox(
      [],
      [alerted, bot("r"), bot("c"), bot("p")],
      now,
      [
        thread("r", { reviewCards: 1, needsYou: true }),
        thread("c", { pendingChanges: 1, needsYou: true }),
        thread("p", { parkedSteps: 1, needsYou: true }),
      ],
    );
    assert.deepEqual(inbox.needs.map((i) => i.id), ["p", "c", "r", "a"]);
  });

  test("several waiting things are counted on the row", () => {
    const inbox = buildInbox([], [bot("p")], now, [thread("p", { parkedSteps: 2, reviewCards: 1, needsYou: true })]);
    assert.equal(botNeedsLine(inbox.needs[0]), "Waiting for your OK · 3 waiting");
  });

  test("a thread that waits on nothing leaves its Bot where it was", () => {
    const inbox = buildInbox([], [bot("q")], now, [thread("q")]);
    assert.equal(inbox.needs.length, 0);
    assert.equal(row(inbox.recent, "q").href, undefined);
  });

  test("a draft is a 'Finish setting up' row that opens its thread", () => {
    const draft = thread("", { id: "cht_draft", botId: undefined, draft: true, title: "Price watch", needsYou: true });
    const inbox = buildInbox([], [], now, [draft]);
    assert.equal(inbox.needs.length, 1);
    const item = inbox.needs[0];
    assert.equal(item.type, "draft");
    assert.equal(botNeedsLine(item), "Finish setting up");
    assert.equal(item.title, "Price watch");
    assert.equal(item.href, "/assistant?bot=cht_draft&thread=cht_draft");
  });

  test("applying the threads again gives the same inbox", () => {
    const threads = [
      thread("p", { parkedSteps: 1, needsYou: true }),
      thread("", { id: "cht_draft", botId: undefined, draft: true, needsYou: true }),
    ];
    const once = buildInbox([], [bot("p")], now, threads);
    assert.deepEqual(applyBotThreads(once, threads), once);
  });

  test("the search box filters them like any other row", () => {
    const inbox = buildInbox([], [bot("p"), bot("c")], now, [
      thread("p", { parkedSteps: 1, needsYou: true }),
      thread("c", { pendingChanges: 1, needsYou: true }),
    ]);
    assert.deepEqual(filterInbox(inbox, "bot c").needs.map((i) => i.id), ["c"]);
  });

  test("the nav badge counts them", () => {
    const threads = [thread("p", { parkedSteps: 1, needsYou: true })];
    assert.equal(needsYouTotal([], [bot("p")], now), 0);
    assert.equal(needsYouTotal([], [bot("p")], now, threads), 1);
  });
});

describe("chats keep their rows", () => {
  test("a chat that waits on the person stays in Needs you, ahead of Bots", () => {
    const inbox = buildInbox(
      [chat("1", { status: "approval" }), chat("2")],
      [bot("p")],
      now,
      [thread("p", { parkedSteps: 1, needsYou: true })],
    );
    assert.deepEqual(inbox.needs.map((i) => `${i.type}:${i.id}`), ["chat:1", "bot:p"]);
    assert.deepEqual(inbox.recent.map((i) => i.id), ["2"]);
  });

  test("a Bot thread chat that waits on a card still puts its Bot in Needs you", () => {
    const inbox = buildInbox(
      [chat("t", { kind: "bot_thread", botId: "p", status: "approval" })],
      [bot("p")],
      now,
    );
    assert.equal(inbox.needs.length, 1);
    assert.equal(inbox.needs[0].type, "bot");
    assert.equal(botNeedsLine(inbox.needs[0]), BOT_NEEDS_WORDS.thread);
  });

  test("Bot thread chats never get a row of their own", () => {
    const inbox = buildInbox([chat("t", { kind: "bot_thread", botId: "p" })], [bot("p")], now);
    assert.deepEqual([...inbox.needs, ...inbox.recent].map((i) => i.type), ["bot"]);
  });
});

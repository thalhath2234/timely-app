// What the agent learned (packages/contract/src/agentLearning.ts): the chat
// chip, the Keep / Discard card, budget meters, status words and the watch
// event both apps read.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  NEXT_CHAT_NOTE,
  budgetMeter,
  cardLine,
  changeLine,
  eventsForRun,
  isLearningWatchEvent,
  learnedSummary,
  learningChip,
  pendingCard,
  statusWord,
} from "../packages/contract/src/agentLearning.ts";

let seq = 0;
const ev = (fields) => ({
  id: `lev_${++seq}`,
  kind: "skill",
  action: "created",
  subject: "bank-csv-import",
  before: "",
  after: "",
  origin: "review",
  conversationId: "chat_1",
  runId: "run_1",
  botId: "",
  taintedSources: [],
  status: "applied",
  ledgerEntryId: "led",
  pendingId: "",
  summary: "",
  createdAt: `2026-11-11T10:00:${String(seq).padStart(2, "0")}Z`,
  updatedAt: "2026-11-11T10:00:00Z",
  ...fields,
});

describe("learningChip", () => {
  test("one learned skill reads like the design", () => {
    const chip = learningChip([ev({})]);
    assert.equal(
      chip.text,
      "Learned: skill 'bank-csv-import' created · View · Undo",
    );
    assert.equal(chip.note, null);
    assert.deepEqual(chip.view, { kind: "skill", subject: "bank-csv-import" });
  });

  test("a memory change says it applies from the next chat", () => {
    const chip = learningChip([
      ev({ kind: "user", action: "added", subject: "user" }),
    ]);
    assert.equal(
      chip.text,
      `Learned: About you added · ${NEXT_CHAT_NOTE} · View · Undo`,
    );
    const notes = learningChip([
      ev({ kind: "memory", action: "replaced", subject: "memory" }),
    ]);
    assert.equal(notes.label, "Learned: note updated");
    assert.equal(notes.note, "applies from your next chat");
  });

  test("several changes name the first and count the rest; Undo covers every live one", () => {
    const events = [
      ev({}),
      ev({ subject: "other", action: "patched" }),
      ev({ kind: "memory", action: "added" }),
    ];
    const chip = learningChip(events);
    assert.equal(
      chip.label,
      "Learned: skill 'bank-csv-import' created and 2 more",
    );
    assert.equal(chip.note, NEXT_CHAT_NOTE);
    assert.deepEqual(
      chip.eventIds,
      events.map((e) => e.id).reverse(),
    );
  });

  test("Undo takes a turn's changes back newest first (a skill created, then patched)", () => {
    const created = ev({ action: "created", createdAt: "2026-11-11T10:00:00Z" });
    const patched = ev({ action: "patched", createdAt: "2026-11-11T10:00:05Z" });
    const chip = learningChip(eventsForRun([patched, created], created.runId));
    assert.deepEqual(chip.eventIds, [patched.id, created.id]);
  });

  test("staged and blocked changes stay off the chip; kept ones are on it", () => {
    assert.equal(
      learningChip([
        ev({ status: "staged", pendingId: "p" }),
        ev({ status: "blocked" }),
      ]),
      null,
    );
    assert.equal(learningChip([]), null);
    const kept = learningChip([ev({ status: "kept", subject: "kept-one" })]);
    assert.equal(kept.label, "Learned: skill 'kept-one' created");
  });

  test("the chip says Undone once every change is taken back", () => {
    const chip = learningChip([
      ev({ status: "undone" }),
      ev({ status: "undone", kind: "memory", action: "added" }),
    ]);
    assert.deepEqual(chip, {
      label: "Undone",
      note: null,
      actions: [],
      eventIds: [],
      view: null,
      text: "Undone",
    });
    const partly = learningChip([
      ev({ status: "undone" }),
      ev({ subject: "still-here" }),
    ]);
    assert.equal(partly.label, "Learned: skill 'still-here' created");
  });
});

describe("pendingCard", () => {
  test("staged changes of a chat that read outside content", () => {
    const card = pendingCard([
      ev({
        status: "staged",
        pendingId: "p1",
        action: "patched",
        subject: "flipkart-price-read",
        summary: "Reads the price box",
        reason: "tainted",
        taintedSources: [{ kind: "web", tool: "web_extract" }],
      }),
      ev({ status: "applied" }),
      ev({ status: "staged", pendingId: "", subject: "no-pending-id" }),
    ]);
    assert.equal(card.title, "Keep what Timely learned?");
    assert.deepEqual(card.items, [
      {
        eventId: card.items[0].eventId,
        pendingId: "p1",
        line: "Skill “flipkart-price-read” updated",
        summary: "Reads the price box",
      },
    ]);
    assert.equal(card.keep, "Keep");
    assert.equal(card.discard, "Discard");
    assert.equal(card.viewDiff, "View diff");
    assert.match(card.why, /outside Timely/);
  });

  test("a clean chat's staged change gives its own reason", () => {
    const card = (fields) =>
      pendingCard([ev({ status: "staged", pendingId: "p", origin: "chat", ...fields })]);
    assert.equal(
      card({ reason: "skill_body" }).why,
      "These steps use tools that need your OK, so they wait for you.",
    );
    assert.equal(
      card({ reason: "unattended", origin: "review" }).why,
      "This changes or removes something Timely already knows, so it waits for you.",
    );
    assert.equal(card({}).why, "Timely waits for you before saving this.");
    assert.match(card({ reason: "tainted" }).why, /outside Timely/);
    // a row from before reasons were kept, with the chat's taint
    assert.match(card({ taintedSources: [{ kind: "web" }] }).why, /outside Timely/);
  });

  test("a bot's suggestion names the bot", () => {
    const card = pendingCard(
      [ev({ status: "staged", pendingId: "p", botId: "bot_1", origin: "bot" })],
      "Deals feed",
    );
    assert.equal(card.title, "Keep what Deals feed learned?");
    assert.match(card.why, /bot/);
  });

  test("nothing staged, no card", () => {
    assert.equal(
      pendingCard([ev({}), ev({ status: "kept", pendingId: "p" })]),
      null,
    );
  });
});

describe("budgetMeter", () => {
  test("counts with grouped digits", () => {
    assert.deepEqual(budgetMeter(1104, 1375), {
      text: "1,104 of 1,375",
      ratio: 1104 / 1375,
      tone: "ok",
    });
    assert.equal(budgetMeter(2000, 2200).tone, "near");
    assert.equal(budgetMeter(2200, 2200).tone, "full");
    assert.equal(budgetMeter(2300, 2200).ratio, 1);
    assert.equal(budgetMeter(0, 0).text, "0 of 0");
    assert.equal(budgetMeter(12, 1375).text, "12 of 1,375");
  });
});

describe("words", () => {
  test("status words", () => {
    assert.equal(statusWord("applied"), "Learned");
    assert.equal(statusWord("staged"), "Waiting for you");
    assert.equal(statusWord("undone"), "Undone");
    assert.equal(statusWord("kept"), "Kept");
    assert.equal(statusWord("discarded"), "Discarded");
    assert.equal(statusWord("blocked"), "Blocked");
    assert.equal(statusWord("something-new"), "something-new");
  });

  test("change lines for the chip and the card", () => {
    assert.equal(
      changeLine({ kind: "skill", action: "stale", subject: "x" }),
      "skill 'x' marked unused",
    );
    assert.equal(
      changeLine({ kind: "memory", action: "removed", subject: "memory" }),
      "note removed",
    );
    assert.equal(
      cardLine({ kind: "user", action: "replaced", subject: "user" }),
      "About you updated",
    );
    assert.equal(
      cardLine({ kind: "skill", action: "created", subject: "x" }),
      "Skill “x” created",
    );
  });

  test("the Settings row summary", () => {
    assert.equal(learnedSummary(14, 1), "14 skills · About you · 1 waiting");
    assert.equal(learnedSummary(1, 0), "1 skill · About you");
    assert.equal(
      learnedSummary(1200, 3),
      "1,200 skills · About you · 3 waiting",
    );
  });
});

describe("events and the watch stream", () => {
  test("a turn's events, oldest first", () => {
    const later = ev({ runId: "run_9", createdAt: "2026-11-11T11:00:00Z" });
    const earlier = ev({ runId: "run_9", createdAt: "2026-11-11T10:59:00Z" });
    assert.deepEqual(
      eventsForRun([later, ev({ runId: "run_other" }), earlier], "run_9"),
      [earlier, later],
    );
    assert.deepEqual(eventsForRun([ev({ runId: "" })], ""), []);
  });

  test("learning watch events", () => {
    assert.equal(
      isLearningWatchEvent({
        type: "learning",
        kind: "chat",
        id: "chat_1",
        document: { eventId: "lev_1", status: "applied" },
      }),
      true,
    );
    assert.equal(
      isLearningWatchEvent({
        type: "learning",
        kind: "chat",
        id: "",
        document: { eventId: "lev_1", status: "undone" },
      }),
      true,
    );
    assert.equal(
      isLearningWatchEvent({
        type: "delta",
        kind: "chat",
        id: "chat_1",
        document: { run: "r", offset: 0, text: "" },
      }),
      false,
    );
    assert.equal(isLearningWatchEvent(null), false);
  });
});

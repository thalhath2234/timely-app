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
  canUndoLearning,
  isLearningWatchEvent,
  laterSkillChanges,
  learnedSummary,
  learningChip,
  pendingCard,
  statusWord,
  undoAlsoText,
  chipUndoAlso,
  learnedSkillCount,
  pendingItemWhy,
  activityStatus,
  learnedOffSummary,
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

describe("Undo", () => {
  test("a skill change's Undo warns about the later changes it also takes back", () => {
    const first = ev({ subject: "aisles", status: "applied", ledgerEntryId: "led-1", createdAt: "2026-11-11T10:00:00Z" });
    const mine = ev({ subject: "aisles", action: "edited", origin: "user", status: "applied", ledgerEntryId: "led-2", createdAt: "2026-11-11T11:00:00Z" });
    const undone = ev({ subject: "aisles", status: "undone", ledgerEntryId: "led-3", createdAt: "2026-11-11T12:00:00Z" });
    const other = ev({ subject: "meals", status: "applied", ledgerEntryId: "led-4", createdAt: "2026-11-11T12:00:00Z" });
    const events = [other, undone, mine, first];
    assert.deepEqual(laterSkillChanges(events, first).map((e) => e.id), [mine.id]);
    assert.equal(undoAlsoText(first, laterSkillChanges(events, first)), "Undo also takes back 1 later change to aisles, including your edit.");
    assert.equal(undoAlsoText(mine, laterSkillChanges(events, mine)), "");
  });

  test("a chat chip's Undo warns about later changes from elsewhere, not the turn's own", () => {
    const made = ev({ id: "a1", subject: "weekly-review", ledgerEntryId: "led-1", runId: "run-a", createdAt: "2026-11-11T10:00:00Z" });
    const sameTurn = ev({ id: "a2", subject: "weekly-review", action: "patched", ledgerEntryId: "led-2", runId: "run-a", createdAt: "2026-11-11T10:00:30Z" });
    const mine = ev({ id: "u1", subject: "weekly-review", action: "edited", origin: "user", ledgerEntryId: "led-3", conversationId: "", runId: "", createdAt: "2026-11-11T10:05:00Z" });
    const elsewhere = ev({ id: "b1", subject: "meals", action: "patched", ledgerEntryId: "led-4", createdAt: "2026-11-11T09:00:00Z" });
    const chip = learningChip([made, sameTurn]);
    assert.equal(chipUndoAlso([mine, sameTurn, made, elsewhere], chip.eventIds), "Undo also takes back 1 later change to weekly-review, including your edit.");
    assert.equal(chipUndoAlso([sameTurn, made, elsewhere], chip.eventIds), "");
    assert.equal(chipUndoAlso([], chip.eventIds), "");
  });

  test("the curator's unused note has nothing to undo", () => {
    assert.equal(canUndoLearning(ev({ action: "stale", status: "applied", ledgerEntryId: "" })), false);
    assert.equal(canUndoLearning(ev({ status: "applied", ledgerEntryId: "led-1" })), true);
    assert.equal(canUndoLearning(ev({ kind: "memory", status: "applied", ledgerEntryId: "" })), true);
    assert.equal(canUndoLearning(ev({ status: "staged", ledgerEntryId: "led-1" })), false);
  });
});

describe("Settings rows", () => {
  test("the skill count leaves out archived skills, as on the phone", () => {
    const skills = [
      { source: "learned", archived: false },
      { source: "learned", archived: true },
      { source: "edited", archived: false },
      { source: "bundled", archived: false },
    ];
    assert.equal(learnedSkillCount(skills), 2);
    assert.equal(learnedSkillCount(undefined), 0);
  });

  test("each waiting change gives its own reason", () => {
    assert.equal(pendingItemWhy(ev({ status: "staged", reason: "tainted" })), "The chat read something from outside Timely.");
    assert.equal(pendingItemWhy(ev({ status: "staged", reason: "unattended" })), "This changes or removes something Timely already knows.");
    assert.equal(pendingItemWhy(ev({ status: "staged", origin: "bot", reason: "bot" })), "A bot suggested this, so it waits for you.");
    assert.equal(pendingItemWhy(ev({ status: "staged", reason: "skill_body" })), "These steps use tools that need your OK.");
  });

  test("the person's own change has no 'Learned' status word", () => {
    assert.equal(activityStatus({ status: "applied", origin: "user" }), "");
    assert.equal(activityStatus({ status: "undone", origin: "user" }), statusWord("undone"));
    assert.equal(activityStatus({ status: "applied", origin: "review" }), statusWord("applied"));
  });
});

describe("Undo warns in the order changes reached the skill (appliedAt)", () => {
  test("a change kept after a newer applied one is later than it", () => {
    const kept = ev({ subject: "aisles", status: "kept", ledgerEntryId: "led-S", createdAt: "2026-11-11T10:00:00Z", appliedAt: "2026-11-11T10:02:00Z" });
    const applied = ev({ subject: "aisles", status: "applied", ledgerEntryId: "led-P", createdAt: "2026-11-11T10:01:00Z", appliedAt: "2026-11-11T10:01:00Z" });
    const events = [kept, applied];
    assert.deepEqual(laterSkillChanges(events, applied).map((e) => e.id), [kept.id]);
    assert.deepEqual(laterSkillChanges(events, kept), []);
    assert.equal(undoAlsoText(applied, laterSkillChanges(events, applied)), "Undo also takes back 1 later change to aisles.");
    assert.notEqual(chipUndoAlso(events, [applied.id]), "");
  });

  test("a turn's patch reported after the person's edit still sorts before it", () => {
    // Go records the edit first (its own reply) and the patch at the run's end;
    // appliedAt is each change's ledger time.
    const edit = ev({ subject: "aisles", action: "edited", origin: "user", ledgerEntryId: "led-E", createdAt: "2026-11-11T10:05:00Z", appliedAt: "2026-11-11T10:04:30Z" });
    const patch = ev({ subject: "aisles", action: "patched", origin: "chat", ledgerEntryId: "led-P", createdAt: "2026-11-11T10:05:10Z", appliedAt: "2026-11-11T10:04:00Z" });
    const events = [edit, patch];
    assert.deepEqual(laterSkillChanges(events, patch).map((e) => e.id), [edit.id]);
    assert.equal(undoAlsoText(patch, laterSkillChanges(events, patch)), "Undo also takes back 1 later change to aisles, including your edit.");
    assert.match(chipUndoAlso(events, [patch.id]), /your edit/);
  });
});

describe("Settings → Agent row with learning off", () => {
  test("says learning is off, and still counts what waits", () => {
    assert.equal(learnedOffSummary(0), "Learning is off");
    assert.equal(learnedOffSummary(2), "Learning is off · 2 waiting");
  });
});

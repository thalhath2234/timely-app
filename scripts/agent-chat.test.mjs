// Chat on the agent engine (packages/contract/src/agentChat.ts): streamed reply
// deltas, the permission copy both apps show, and question cards (phase 4).
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  ALWAYS_BLOCKED_NOTE,
  AUTO_ASKS_BEFORE,
  DEFAULT_CHAT_SETTINGS,
  ENGINE_COPY,
  FULL_ACCESS_CONFIRM,
  FULL_ACCESS_PHONE_NOTE,
  PERMISSION_COPY,
  PERMISSION_MODES,
  USE_CLASSIC_ACTION,
  USE_CLASSIC_LABEL,
  QUESTION_CARD_TITLES,
  QUESTION_CLOSED,
  QUESTION_LIMITS,
  QUESTION_PUSH,
  QUESTION_STATUS_WORD,
  answerProblem,
  answerSummary,
  applyDelta,
  cleanAnswers,
  draftFromActivity,
  questionCardState,
  questionSecondsLeft,
  questionStatusWord,
  questionTimeLeft,
  questionWaiting,
} from "../packages/contract/src/agentChat.ts";

const delta = (run, offset, text) => ({ type: "delta", kind: "chat", id: "chat_1", document: { run, offset, text } });

describe("applyDelta", () => {
  test("appends a chunk that starts where the draft ends", () => {
    let { draft, refetch } = applyDelta(null, delta("run-1", 0, "Sure, "));
    assert.equal(refetch, false);
    ({ draft, refetch } = applyDelta(draft, delta("run-1", 6, "I added it.")));
    assert.deepEqual(draft, { run: "run-1", text: "Sure, I added it.", chars: 17 });
    assert.equal(refetch, false);
  });

  test("drops the part of a chunk the draft already has", () => {
    const start = applyDelta(null, delta("run-1", 0, "Hello wor")).draft;
    const again = applyDelta(start, delta("run-1", 6, "world!"));
    assert.equal(again.draft.text, "Hello world!");
    const repeat = applyDelta(again.draft, delta("run-1", 0, "Hello"));
    assert.equal(repeat.draft.text, "Hello world!");
    assert.equal(repeat.refetch, false);
  });

  test("asks for a refetch when a chunk was missed, keeping the draft", () => {
    const start = applyDelta(null, delta("run-1", 0, "One ")).draft;
    const gap = applyDelta(start, delta("run-1", 10, "three"));
    assert.equal(gap.refetch, true);
    assert.deepEqual(gap.draft, start);
    const late = applyDelta(null, delta("run-1", 40, "tail"));
    assert.equal(late.refetch, true);
    assert.equal(late.draft, null);
    assert.equal(applyDelta(start, delta("run-1", -1, "x")).refetch, true);
  });

  test("a new run starts its own draft", () => {
    const old = applyDelta(null, delta("run-1", 0, "Old reply")).draft;
    const next = applyDelta(old, delta("run-2", 0, "New"));
    assert.deepEqual(next.draft, { run: "run-2", text: "New", chars: 3 });
    assert.equal(applyDelta(old, delta("run-2", 5, "x")).refetch, true);
  });

  test("offsets count characters, not UTF-16 units", () => {
    const start = applyDelta(null, delta("run-1", 0, "日本🎉")).draft;
    assert.equal(start.chars, 3);
    const next = applyDelta(start, delta("run-1", 3, "です"));
    assert.equal(next.draft.text, "日本🎉です");
    const overlap = applyDelta(next.draft, delta("run-1", 2, "🎉ですね"));
    assert.equal(overlap.draft.text, "日本🎉ですね");
  });

  test("a late joiner continues from the stored draft", () => {
    assert.equal(draftFromActivity({}), null);
    const draft = draftFromActivity({ run: "run-1", lines: [], draft: "Looking at 🎉" });
    assert.deepEqual(draft, { run: "run-1", text: "Looking at 🎉", chars: 12 });
    assert.equal(applyDelta(draft, delta("run-1", 12, " now")).draft.text, "Looking at 🎉 now");
  });
});

describe("permission copy", () => {
  test("every mode has a name, both descriptions and its drawn chip", () => {
    assert.deepEqual([...PERMISSION_MODES], ["supervised", "auto", "full"]);
    for (const mode of PERMISSION_MODES) {
      const copy = PERMISSION_COPY[mode];
      assert.ok(copy.name && copy.description && copy.short, mode);
    }
    assert.deepEqual(
      PERMISSION_MODES.map((m) => [PERMISSION_COPY[m].name, PERMISSION_COPY[m].icon, PERMISSION_COPY[m].tone]),
      [
        ["Supervised", "eye", "green"],
        ["Auto", "shield", "indigo"],
        ["Full Access", "bolt", "amber"],
      ],
    );
  });

  test("Full Access never promises that nothing asks in phase 2", () => {
    for (const text of [PERMISSION_COPY.full.description, PERMISSION_COPY.full.short, FULL_ACCESS_CONFIRM]) {
      assert.doesNotMatch(text, /never asks|nothing asks|without asking/i);
      assert.match(text, /like Auto/);
    }
    assert.equal(FULL_ACCESS_PHONE_NOTE, "Turn on from the desktop app");
  });

  test("the six rows Auto always asks before, as drawn", () => {
    assert.deepEqual(
      AUTO_ASKS_BEFORE.map((row) => [row.item, row.title, row.detail ?? ""]),
      [
        [1, "Deleting or overwriting", ""],
        [2, "Sending your data out", "To a site you haven’t used, or by email or post"],
        [3, "Buying, paying or signing in", ""],
        [4, "Installing software", ""],
        [5, "Changing settings or permissions", ""],
        [6, "Changes after reading outside pages", "A page could have told it what to do"],
      ],
    );
    assert.match(ALWAYS_BLOCKED_NOTE, /every mode/);
  });

  test("defaults and engine words", () => {
    assert.deepEqual(DEFAULT_CHAT_SETTINGS, { engine: "classic", chatPermission: "supervised", botPermission: "auto", fullAccessAllowedOn: "desktop" });
    assert.equal(ENGINE_COPY.classic.name, "Classic");
    assert.equal(ENGINE_COPY.agent.name, "New");
    assert.equal(USE_CLASSIC_ACTION, "use_classic");
    assert.equal(USE_CLASSIC_LABEL, "Use classic for this chat");
  });
});

const card = {
  requestId: "req-1",
  run: "run_1",
  questions: [
    { qid: "q0", question: "Which day?", choices: ["Mon", "Tue"], recommended: 0, multiSelect: false },
    { qid: "q1", question: "Which rooms?", choices: ["A", "B", "C"], recommended: null, multiSelect: true },
    { qid: "q2", question: "Anything else?", choices: null, recommended: null, multiSelect: false },
  ],
  askedAt: "2026-11-13T09:00:00Z",
  expiresAt: "2026-11-13T09:10:00Z",
};

describe("question cards", () => {
  test("a running chat with a card needs an answer; any other row does not", () => {
    assert.equal(questionWaiting({ status: "running", question: card }), true);
    assert.equal(questionStatusWord({ status: "running", question: card }), "Needs your answer");
    assert.equal(QUESTION_STATUS_WORD, "Needs your answer");
    for (const row of [
      { status: "running", question: {} },
      { status: "running" },
      { status: "stopped", question: card },
      { status: "idle", question: {} },
      { status: "running", question: { requestId: "req-1", questions: [] } },
      null,
    ]) {
      assert.equal(questionWaiting(row), false, JSON.stringify(row));
      assert.equal(questionStatusWord(row), null);
    }
  });

  test("each outcome maps to its card state and title", () => {
    const want = { submitted: "answered", cancelled: "skipped", timed_out: "expired", undelivered: "expired", stopped: "stopped" };
    for (const [outcome, state] of Object.entries(want)) assert.equal(questionCardState(outcome), state);
    assert.equal(questionCardState(undefined), "waiting");
    assert.deepEqual(QUESTION_CARD_TITLES, {
      waiting: "Timely needs an answer",
      answered: "Answered",
      skipped: "Skipped",
      expired: "Not answered in time",
      stopped: "Stopped before you answered",
    });
    assert.equal(QUESTION_PUSH, "Timely has a question.");
    assert.equal(QUESTION_CLOSED, "This question was already closed");
  });

  test("time left counts down to the expiry", () => {
    assert.equal(questionSecondsLeft(card, Date.parse("2026-11-13T09:00:00Z")), 600);
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:00:00Z")), "10 min left");
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:09:15Z")), "45 s left");
    assert.equal(questionSecondsLeft(card, new Date("2026-11-13T09:20:00Z")), 0);
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:20:00Z")), "");
    assert.equal(questionSecondsLeft({}, Date.now()), null);
  });

  test("answers are cleaned and checked as the server checks them", () => {
    const answers = cleanAnswers({ q0: " Tue ", q1: ["B", "A", "B", " "], q2: "   " });
    assert.deepEqual(answers, { q0: "Tue", q1: ["B", "A"], q2: null });
    assert.equal(answerProblem(card.questions, answers), null);
    assert.equal(answerProblem(card.questions, { q0: "Friday instead" }), null, "typed text answers a single-select question");
    assert.equal(answerProblem(card.questions, { q1: ["A", "the garden"] }), null, "one typed pick in a multi-select");
    assert.match(answerProblem(card.questions, { q9: "x" }), /no question/);
    assert.match(answerProblem(card.questions, { q0: ["Mon"] }), /Pick one/);
    assert.match(answerProblem(card.questions, { q2: ["x"] }), /Pick one/);
    assert.match(answerProblem(card.questions, { q1: ["A", "x", "y"] }), /choices/);
    assert.match(answerProblem(card.questions, { q2: "x".repeat(QUESTION_LIMITS.answerChars + 1) }), /2,000/);
    assert.deepEqual(QUESTION_LIMITS, { questions: 5, choices: 4, answerChars: 2000 });
  });

  test("an answered card sums up one line per question", () => {
    const answered = { requestId: "req-1", questions: card.questions, answers: { q0: "Tue", q1: ["A", "C"], q2: null }, outcome: "submitted" };
    assert.deepEqual(answerSummary(answered), [
      { question: "Which day?", answer: "Tue" },
      { question: "Which rooms?", answer: "A, C" },
      { question: "Anything else?", answer: "—" },
    ]);
  });
});

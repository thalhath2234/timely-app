// Chat on the agent engine (packages/contract/src/agentChat.ts): streamed reply
// deltas, the permission copy both apps show, question cards (phase 4) and
// host cards (phase 5).
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
  HOST_BUTTONS,
  HOST_CARD_STATE_WORDS,
  HOST_ERRORS,
  HOST_STATUS_WORDS,
  HOST_TIMEOUT_LIMITS,
  HOST_UNDO,
  cardStatusWord,
  hostCanUndo,
  hostCardState,
  hostCardTitle,
  hostChoices,
  hostNeedsUnlock,
  hostSecondsLeft,
  hostStatusWord,
  hostSubject,
  hostTimeLeft,
  hostWaiting,
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

  test("Full Access says what it lifts and what stays (phase 5)", () => {
    for (const text of [PERMISSION_COPY.full.description, PERMISSION_COPY.full.short]) {
      assert.match(text, /Timely data still asks? like Auto/);
      assert.doesNotMatch(text, /never asks|nothing asks|for now/i);
    }
    for (const lifted of ["commands", "files", "code", "MCP tools"]) assert.ok(FULL_ACCESS_CONFIRM.includes(lifted), lifted);
    // the signed-in browser keeps its card until the network-level control exists (plan 14)
    assert.match(FULL_ACCESS_CONFIRM, /signed-in browser still asks/);
    assert.match(PERMISSION_COPY.full.description, /signed-in browser still asks/);
    for (const kept of ["wipe a disk", "keys", "other accounts", "outside pages"]) assert.ok(FULL_ACCESS_CONFIRM.includes(kept), kept);
    assert.match(FULL_ACCESS_CONFIRM, /Turn it on for this chat\?$/);
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
        [6, "Changes after reading outside content", "A page, file or command output could have told it what to do"],
      ],
    );
    assert.match(ALWAYS_BLOCKED_NOTE, /every mode/);
  });

  test("defaults and engine words", () => {
    assert.deepEqual(DEFAULT_CHAT_SETTINGS, {
      engine: "classic",
      chatPermission: "supervised",
      botPermission: "auto",
      fullAccessAllowedOn: "desktop",
      hostApprovalRule: "devices",
      hostApprovalTimeoutMinutes: 60,
    });
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
    // Minutes round down: 61 s left is "1 min", never "2 min" (the card would expire a minute early).
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:08:59Z")), "1 min left");
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:08:00Z")), "2 min left");
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:00:01Z")), "9 min left");
    assert.equal(questionTimeLeft(card, Date.parse("2026-11-13T09:09:01Z")), "59 s left");
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

describe("host cards", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");
  const card = { kind: "terminal", title: "Run this command?", command: "ls -la", cwd: "/work", reason: "Supervised asks before every action", grantable: true };
  const live = { requestId: "req-1", run: "run_1", phase: "live", tool: "terminal", card, liveUntil: "2026-11-14T10:09:30Z", expiresAt: undefined };
  const parked = { ...live, phase: "parked", liveUntil: "2026-11-14T09:50:00Z", expiresAt: "2026-11-14T10:45:00Z" };

  test("the words both apps show", () => {
    assert.deepEqual(HOST_BUTTONS, { once: "Run once", chat: "Allow for this chat", deny: "Deny" });
    assert.deepEqual(HOST_STATUS_WORDS, { live: "Needs your OK", parked: "Waiting for your OK" });
    // one word for a parked card in the header, the list and on the card itself
    assert.equal(HOST_STATUS_WORDS.parked, HOST_CARD_STATE_WORDS.parked);
    assert.equal(HOST_STATUS_WORDS.live, HOST_CARD_STATE_WORDS.live);
    assert.deepEqual(Object.values(HOST_CARD_STATE_WORDS), [
      "Needs your OK",
      "Waiting for your OK",
      "Ran",
      "Allowed for this chat",
      "Denied",
      "Expired, not run",
      "Stopped before you answered",
      "Approved, waiting to run",
      "Approved, did not run",
    ]);
    assert.equal(HOST_UNDO, "Undo this change");
    assert.equal(HOST_ERRORS.phoneLocked, "Unlock your phone to approve this");
    assert.deepEqual(HOST_TIMEOUT_LIMITS, { min: 10, max: 60, default: 60 });
  });

  test("titles by kind, as Go words them", () => {
    assert.deepEqual(
      ["terminal", "file", "code", "browser", "mcp_server"].map((kind) => hostCardTitle({ kind })),
      ["Run this command?", "Change this file?", "Run this code?", "Use your browser?", "Add this MCP server?"],
    );
    assert.equal(hostCardTitle({ kind: "mcp", server: "github" }), "Use github?");
    assert.equal(hostSubject(card), "ls -la");
    assert.equal(hostSubject({ ...card, command: undefined, path: "notes.md" }), "notes.md");
    assert.equal(hostSubject(null), "");
  });

  test("waiting and status words for live and parked cards", () => {
    assert.equal(hostWaiting({ status: "host_approval", hostRequest: live }), true);
    assert.equal(hostWaiting({ status: "host_approval", hostRequest: {} }), false);
    assert.equal(hostWaiting({ status: "running", hostRequest: live }), false);
    assert.equal(hostStatusWord({ status: "host_approval", hostRequest: live }), "Needs your OK");
    assert.equal(hostStatusWord({ status: "host_approval", hostRequest: parked }), "Waiting for your OK");
    assert.equal(hostStatusWord({ status: "idle", hostRequest: {} }), null);
    const question = { requestId: "q", run: "r", questions: [{ qid: "q0", question: "Which?", choices: null, recommended: null, multiSelect: false }] };
    assert.equal(cardStatusWord({ status: "running", question }), "Needs your answer");
    assert.equal(cardStatusWord({ status: "host_approval", hostRequest: parked, question: {} }), "Waiting for your OK");
    assert.equal(cardStatusWord({ status: "idle" }), null);
  });

  test("card states, open and closed", () => {
    assert.equal(hostCardState(live), "live");
    assert.equal(hostCardState(parked), "parked");
    for (const outcome of ["ran", "allowed", "denied", "expired", "stopped"]) assert.equal(hostCardState({ tool: "terminal", outcome }), outcome);
    assert.equal(hostCardState({ tool: "terminal", outcome: "bogus" }), "stopped");
    assert.equal(hostCardState(null), "live");
  });

  test("choices: Allow for this chat only when grantable; the phone unlocks except to deny", () => {
    assert.deepEqual(hostChoices(live), ["once", "chat", "deny"]);
    assert.deepEqual(hostChoices({ ...live, card: { ...card, grantable: false } }), ["once", "deny"]);
    assert.deepEqual(hostChoices(null), ["once", "deny"]);
    assert.equal(hostNeedsUnlock("once", "phone"), true);
    assert.equal(hostNeedsUnlock("chat", "phone"), true);
    assert.equal(hostNeedsUnlock("deny", "phone"), false);
    assert.equal(hostNeedsUnlock("once", "web"), false);
  });

  test("time left: the live wait, then the parked expiry", () => {
    assert.equal(hostSecondsLeft(live, now), 570);
    assert.equal(hostTimeLeft(live, now), "Pauses in 9 min");
    assert.equal(hostSecondsLeft(parked, now), 2700);
    assert.equal(hostTimeLeft(parked, now), "Closes in 45 min");
    assert.equal(hostTimeLeft({ ...live, liveUntil: "2026-11-14T10:00:45Z" }, now), "Pauses in 45 s");
    assert.equal(hostTimeLeft({ ...live, liveUntil: "2026-11-14T09:00:00Z" }, now), "");
    assert.equal(hostSecondsLeft({ phase: "live" }, now), null);
  });

  test("Undo this change while a checkpoint exists and was not undone", () => {
    assert.equal(hostCanUndo({ tool: "write_file", outcome: "ran", checkpoint: "abc" }), true);
    assert.equal(hostCanUndo({ tool: "write_file", outcome: "ran", checkpoint: "abc", undoneAt: "2026-11-14T10:01:00Z" }), false);
    assert.equal(hostCanUndo({ tool: "terminal", outcome: "ran" }), false);
    assert.equal(hostCanUndo(null), false);
  });
});

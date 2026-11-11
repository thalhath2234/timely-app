import assert from "node:assert/strict";
import { test } from "node:test";
import { routeForNotification } from "../apps/mobile/lib/notificationRoute.ts";
import {
  contextChip,
  draftForScreen,
  mergeContext,
  routeContext,
  routeObject,
} from "../apps/mobile/lib/chat/context.ts";
import {
  stepIconKind,
  stepTarget,
} from "../apps/mobile/components/chat/stepTarget.ts";
import {
  agentRunLive,
  appliedSteps,
  autoAppliedState,
  autoCardArchives,
  canPickPermission,
  chatPermission,
  composerMode,
  effectiveEngine,
  engineLabel,
  fullAccessDisabledOnPhone,
  isChatDelta,
  isUndoPlan,
  mergeActivityDraft,
  offersUseClassic,
  onDelta,
  permissionChip,
  permissionHint,
  permissionOptions,
  planSummaryHidden,
  visibleDraft,
  wantsReplyStream,
} from "../apps/mobile/lib/chat/agentRun.ts";

test("agent notification targets its chat and retains existing reminder routing", () => {
  assert.equal(
    routeForNotification({
      category: "agent",
      entityType: "chat",
      entityId: "chat-a",
    }),
    "/(app)/assistant?chatId=chat-a",
  );
  assert.equal(
    routeForNotification({ chatId: "chat/b" }),
    "/(app)/assistant?chatId=chat%2Fb",
  );
  assert.equal(
    routeForNotification({ taskId: "task-a" }),
    "/(app)/tasks/task-a",
  );
});
test("a smart alert about several tasks opens the first, a project or Inbox alert its own screen", () => {
  assert.equal(
    routeForNotification({
      category: "suggestion",
      kind: "stale",
      taskIds: ["task-a", "task-b"],
      entityId: null,
    }),
    "/(app)/tasks/task-a",
  );
  assert.equal(
    routeForNotification({
      category: "suggestion",
      kind: "project",
      projectId: "pr-a",
      taskIds: ["task-a"],
    }),
    "/(app)/projects/pr-a",
  );
  assert.equal(
    routeForNotification({
      category: "suggestion",
      kind: "inbox",
      taskIds: ["task-a"],
    }),
    "/(app)/inbox",
  );
});
test("a Bot alert opens its bot on the Bots tab", () => {
  // The shape the server push and the phone's own poll both send.
  assert.equal(
    routeForNotification({
      category: "bot",
      entityType: "bot",
      entityId: "bot_a",
      botId: "bot_a",
      taskId: "",
      url: "https://example.com/item",
    }),
    "/(app)/(tabs)/bots?bot=bot_a",
  );
  // The entity names the bot when botId is missing; ids are escaped.
  assert.equal(
    routeForNotification({
      category: "bot",
      entityType: "bot",
      entityId: "bot/b",
    }),
    "/(app)/(tabs)/bots?bot=bot%2Fb",
  );
});
test("a Bot alert that names no bot opens the Bots board", () => {
  assert.equal(
    routeForNotification({ category: "bot", botId: "", taskId: "" }),
    "/(app)/(tabs)/bots",
  );
  assert.equal(
    routeForNotification({ category: "bot", kind: "digest" }),
    "/(app)/(tabs)/bots",
  );
});

test("a bot's screen path names the bot as the chat's object", () => {
  assert.deepEqual(routeObject("/bots/bot_a"), ["bots", "bot_a"]);
  assert.deepEqual(routeObject("/(app)/(tabs)/bots/bot_a"), ["bots", "bot_a"]);
  // The board itself is a place, not an object.
  assert.equal(routeObject("/bots"), null);
  const chips = routeContext("/bots/bot_a", {}, { name: "Sony WH-1000XM6" });
  assert.deepEqual(
    chips.find((c) => c.kind === "object"),
    contextChip("object", "Sony WH-1000XM6", "bots/bot_a"),
  );
});
test("a made or changed bot opens its sheet on the Bots tab", () => {
  const created = stepTarget({
    tool: "create_bot",
    status: "done",
    arguments: { name: "Go blog" },
    result: { id: "bot_a1", name: "Go blog", status: "active" },
  });
  assert.deepEqual(created, {
    href: "/bots?bot=bot_a1",
    title: "Go blog",
    noun: "bot",
  });
  // update_bot names its bot by id in its arguments when the result has none.
  assert.deepEqual(
    stepTarget({ tool: "update_bot", status: "done", arguments: { bot: "bot_b" } }),
    { href: "/bots?bot=bot_b", title: undefined, noun: "bot" },
  );
  // A bot named by its name has no id to open.
  assert.equal(
    stepTarget({ tool: "update_bot", status: "done", arguments: { bot: "Go blog" } }),
    null,
  );
  assert.equal(stepIconKind("create_bot"), "bot");
  assert.equal(stepIconKind("update_bot"), "bot");
  assert.equal(stepIconKind("delete_bot"), "remove");
  assert.equal(stepIconKind("update_doc"), "doc");
});

test("adding a new screen preserves original context and deduplicates references", () => {
  const original = routeContext(
    "/docs/doc-a",
    {},
    { title: "Plan", workspaceId: "workspace-a" },
  );
  const incoming = routeContext(
    "/sheets/sheet-a",
    {},
    { title: "Budget", workspaceId: "workspace-a" },
  );
  const merged = mergeContext(original, incoming);
  assert.equal(merged.filter((c) => c.kind === "workspace").length, 1);
  assert.ok(merged.some((c) => c.value === "docs/doc-a"));
  assert.ok(merged.some((c) => c.value === "sheets/sheet-a"));
  assert.deepEqual(
    original.map((c) => c.value),
    ["/docs/doc-a", "docs/doc-a", "workspace-a"],
  );
});
test("scope is never silently dropped to fit context limits", () => {
  assert.throws(
    () =>
      mergeContext(
        [],
        Array.from({ length: 9 }, (_, i) =>
          contextChip("object", "Task", `tasks/${i}`),
        ),
      ),
    /maximum eight/,
  );
  assert.throws(
    () =>
      mergeContext(
        [],
        [contextChip("selection", "Japanese text", "あ".repeat(4001))],
      ),
    /too large/,
  );
  assert.doesNotThrow(() =>
    mergeContext(
      [],
      [contextChip("selection", "Japanese text", "あ".repeat(4000))],
    ),
  );
});

const screenA = routeContext("/tasks/task-a", {}, { title: "Call mum" });
const screenB = routeContext("/projects/pr-b", {}, { title: "Garden" });
const draft = (fields = {}) => ({
  text: "",
  context: screenA,
  webSearch: false,
  images: [],
  ...fields,
});
test("a pinch on another screen replaces the context an empty draft kept", () => {
  // Opened on task A and closed without typing (or used to read old chats).
  const next = draftForScreen(draft(), () => screenB);
  assert.deepEqual(next.context, screenB);
  assert.equal(next.conversationId, undefined);
  assert.deepEqual(draftForScreen(null, () => screenB).context, screenB);
  // An emptied reply in an old conversation no longer reopens that chat.
  const emptied = draftForScreen(
    draft({ conversationId: "chat-a" }),
    () => screenB,
  );
  assert.equal(emptied.conversationId, undefined);
  assert.deepEqual(emptied.context, screenB);
});
test("typed text moves to the pinched screen, unless it is the same screen", () => {
  const moved = draftForScreen(
    draft({ text: "What is left here?", provider: "openrouter", model: "m" }),
    () => screenB,
  );
  assert.equal(moved.text, "What is left here?");
  assert.equal(moved.model, "m");
  assert.deepEqual(moved.context, screenB);
  // Same screen: chips the person removed stay removed.
  const trimmed = draft({ text: "Hi", context: screenA.slice(0, 1) });
  assert.equal(
    draftForScreen(trimmed, () => screenA),
    trimmed,
  );
});
test("a reply to an old chat and a message being sent reopen untouched", () => {
  const reply = draft({ text: "And tomorrow?", conversationId: "chat-a" });
  const sending = draft({ text: "Plan my day", requestId: "req-1" });
  const unused = () => {
    throw new Error("screen context is not needed");
  };
  assert.equal(draftForScreen(reply, unused), reply);
  assert.equal(draftForScreen(sending, unused), sending);
});
const { receiptReviewProblems } = await import(
  "../apps/mobile/lib/chat/receiptReview.ts"
);
const receipt = (items = ["179", "398", "398", "684", "248", "236"]) => ({
  merchant: "業務スーパー",
  date: "2026-09-30",
  currency: "JPY",
  total: "2318",
  subtotal: "2147",
  tax: "171",
  tip: "",
  discount: "",
  category: "groceries",
  taxIncluded: false,
  issues: [],
  items: items.map((amount) => ({
    description: "Printed item",
    amount,
    quantity: "1",
    unitPrice: amount,
    category: "",
  })),
});
test("receipt review explains the missing bag amount and clears after correction", () => {
  const problems = receiptReviewProblems(receipt());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2143.*2147.*Difference: 4/);
  assert.deepEqual(
    receiptReviewProblems(
      receipt(["179", "398", "398", "684", "248", "236", "4"]),
    ),
    [],
  );
});
test("receipt review handles decimal currencies and included tax/discount", () => {
  const draft = {
    ...receipt(["0.1", "0.2"]),
    currency: "USD",
    subtotal: "0.3",
    total: "0.3",
    tax: "0.02",
    discount: "0.1",
    taxIncluded: true,
    discountIncluded: true,
  };
  assert.deepEqual(receiptReviewProblems(draft), []);
});
test("summary-only receipts and incomplete items have useful review feedback", () => {
  const summary = { ...receipt([]), subtotal: "", tax: "" };
  assert.deepEqual(receiptReviewProblems(summary), []);
  const incomplete = {
    ...summary,
    items: [
      {
        description: "",
        amount: "",
        quantity: "",
        unitPrice: "",
        category: "",
      },
    ],
  };
  assert.deepEqual(receiptReviewProblems(incomplete), [
    "Enter a name for item 1.",
    "Enter the amount for item 1.",
  ]);
});
const { settingsOf, changed } = await import(
  "../apps/mobile/lib/chat/settings.ts"
);
const shown = {
  context: screenA,
  webSearch: false,
  model: { provider: "anthropic", model: "claude-opus-5-5" },
};
test("a chat's settings default to no context, no search and the account model", () => {
  assert.deepEqual(settingsOf({ id: "chat-a", revision: 1 }), {
    context: [],
    webSearch: false,
    model: { provider: "", model: "" },
  });
  assert.deepEqual(
    settingsOf({
      context: screenA,
      webSearch: true,
      chosenProvider: "openrouter",
      chosenModel: "m",
    }),
    {
      context: screenA,
      webSearch: true,
      model: { provider: "openrouter", model: "m" },
    },
  );
});
test("a settings tap saves only what differs from what the composer shows", () => {
  assert.equal(changed({}, shown), undefined);
  assert.equal(
    changed(
      { context: [...screenA], webSearch: false, model: { ...shown.model } },
      shown,
    ),
    undefined,
  );
  assert.deepEqual(changed({ context: screenA, webSearch: true }, shown), {
    webSearch: true,
  });
  assert.deepEqual(changed({ context: screenA.slice(1) }, shown), {
    context: screenA.slice(1),
  });
  assert.deepEqual(changed({ context: [...screenA].reverse() }, shown), {
    context: [...screenA].reverse(),
  });
  assert.deepEqual(
    changed({ model: { provider: "anthropic", model: "other" } }, shown),
    { model: { provider: "anthropic", model: "other" } },
  );
  assert.deepEqual(changed({ model: { provider: "", model: "" } }, shown), {
    model: { provider: "", model: "" },
  });
});

// Chat on the agent engine (phase 2): streamed reply, permission chip and
// picker, steer, Undo and Use classic (apps/mobile/lib/chat/agentRun.ts).
const delta = (run, offset, text, id = "chat_1") => ({ type: "delta", kind: "chat", id, document: { run, offset, text } });
const live = (over = {}) => ({ id: "chat_1", status: "running", phase: "plan", runEngine: "agent", engine: "", activity: { run: "run_1" }, ...over });

test("deltas for the open chat append, drop overlaps, and ask for a refetch after a gap", () => {
  let state = onDelta("chat_1", null, delta("run_1", 0, "Hel"));
  assert.deepEqual(state, { draft: { run: "run_1", text: "Hel", chars: 3 }, refetch: false });
  state = onDelta("chat_1", state.draft, delta("run_1", 3, "lo "));
  assert.equal(state.draft.text, "Hello ");
  // A repeated chunk adds only what is new.
  state = onDelta("chat_1", state.draft, delta("run_1", 4, "o wo"));
  assert.equal(state.draft.text, "Hello wo");
  assert.equal(state.refetch, false);
  // A missed chunk keeps the text and refetches.
  const gap = onDelta("chat_1", state.draft, delta("run_1", 20, "late"));
  assert.equal(gap.refetch, true);
  assert.equal(gap.draft.text, "Hello wo");
  // Offsets count code points, not UTF-16 units.
  const emoji = onDelta("chat_1", { run: "run_1", text: "Hi 👋", chars: 4 }, delta("run_1", 4, "!"));
  assert.deepEqual(emoji, { draft: { run: "run_1", text: "Hi 👋!", chars: 5 }, refetch: false });
});

test("deltas of another chat change nothing, and only well-formed frames count", () => {
  const draft = { run: "run_1", text: "Hi", chars: 2 };
  assert.deepEqual(onDelta("chat_1", draft, delta("run_9", 0, "other", "chat_2")), { draft, refetch: false });
  assert.deepEqual(onDelta(null, draft, delta("run_1", 2, "!")), { draft, refetch: false });
  assert.equal(isChatDelta(delta("run_1", 0, "x")), true);
  assert.equal(isChatDelta({ type: "changed", id: "chat_1" }), false);
  assert.equal(isChatDelta({ type: "delta", id: "chat_1", document: { run: "r", offset: "0", text: "x" } }), false);
});

test("a refetch continues from activity.draft only when it knows more, and the run's end drops the draft", () => {
  const ours = { run: "run_1", text: "Hello wo", chars: 8 };
  assert.equal(mergeActivityDraft(ours, { run: "run_1", draft: "Hello" }), ours);
  assert.deepEqual(mergeActivityDraft(ours, { run: "run_1", draft: "Hello world" }), { run: "run_1", text: "Hello world", chars: 11 });
  assert.deepEqual(mergeActivityDraft(ours, { run: "run_2", draft: "New" }), { run: "run_2", text: "New", chars: 3 });
  assert.deepEqual(mergeActivityDraft(null, { run: "run_1" }), { run: "run_1", text: "", chars: 0 });
  assert.equal(mergeActivityDraft(ours, {}), null);
  assert.equal(mergeActivityDraft(ours, undefined), null);
});

test("streamed text shows only while its run is live in the chat", () => {
  const draft = { run: "run_1", text: "Writing", chars: 7 };
  assert.equal(visibleDraft(live(), draft), "Writing");
  assert.equal(visibleDraft(live({ status: "idle", activity: {} }), draft), "");
  assert.equal(visibleDraft(live({ activity: { run: "run_2" } }), draft), "");
  assert.equal(visibleDraft(live({ phase: "apply" }), draft), "");
  assert.equal(visibleDraft(live(), null), "");
});

test("the stream follows a live agent run or a queued run that will start on the agent engine", () => {
  assert.equal(wantsReplyStream(live(), "classic"), true);
  assert.equal(wantsReplyStream(live({ status: "idle" }), "agent"), false);
  assert.equal(wantsReplyStream(live({ runEngine: "classic", activity: {} }), "classic"), false);
  assert.equal(wantsReplyStream(live({ status: "queued", runEngine: "", activity: {} }), "agent"), true);
  assert.equal(wantsReplyStream(live({ status: "queued", runEngine: "", activity: {}, engine: "classic" }), "agent"), false);
  // Sensitive chats always run classic.
  assert.equal(effectiveEngine({ engine: "agent", sensitive: true }, "agent"), "classic");
  assert.equal(effectiveEngine({ engine: "" }, "agent"), "agent");
  assert.equal(effectiveEngine({ engine: "" }, undefined), "classic");
  assert.equal(agentRunLive(live({ phase: "apply" })), false);
});

test("sending while an agent run is live steers it; a classic run or an apply only offers Stop", () => {
  assert.equal(composerMode(undefined), "send");
  assert.equal(composerMode(live({ status: "idle" })), "send");
  assert.equal(composerMode(live()), "steer");
  assert.equal(composerMode(live({ status: "queued" })), "none");
  assert.equal(composerMode(live({ runEngine: "classic", activity: {} })), "none");
  assert.equal(composerMode(live({ phase: "apply" })), "none");
});

test("the header chip maps each mode to its drawn glyph and tone, Supervised for older rows", () => {
  assert.deepEqual(
    ["supervised", "auto", "full"].map((mode) => {
      const chip = permissionChip(mode);
      return [chip.label, chip.icon, chip.tone];
    }),
    [
      ["Supervised", "eye", "green"],
      ["Auto", "shield", "indigo"],
      ["Full Access", "bolt", "amber"],
    ],
  );
  assert.equal(permissionChip(undefined).mode, "supervised");
  assert.equal(permissionChip("everything").mode, "supervised");
  assert.equal(chatPermission("auto"), "auto");
  assert.match(permissionChip("auto").accessibilityLabel, /^Permission: Auto/);
  assert.equal(permissionHint("supervised"), "Every change waits for your review.");
  assert.match(permissionHint("auto"), /Undo/);
});

test("the phone can't turn on Full Access in phase 2, but a chat already on it keeps it chosen", () => {
  assert.equal(fullAccessDisabledOnPhone(), true);
  const options = permissionOptions("auto");
  assert.deepEqual(options.map((o) => [o.mode, o.selected, o.disabled]), [
    ["supervised", false, false],
    ["auto", true, false],
    ["full", false, true],
  ]);
  assert.match(options[2].line, /Turn on from the desktop app/);
  assert.doesNotMatch(options[2].line, /never asks/i);
  assert.equal(canPickPermission("auto", "full"), false);
  assert.equal(canPickPermission("auto", "supervised"), true);
  assert.equal(canPickPermission("auto", "auto"), false);
  const onFull = permissionOptions("full");
  assert.deepEqual(onFull.map((o) => [o.mode, o.selected, o.disabled]), [
    ["supervised", false, false],
    ["auto", false, false],
    ["full", true, false],
  ]);
  assert.equal(canPickPermission("full", "auto"), true);
});

test("an auto-applied change offers Undo while the chat is idle, and the bottom plan card steps aside", () => {
  const proposal = { id: "p1", role: "assistant", content: "Added two tasks", proposal: true, autoApplied: true, createdAt: "" };
  const plan = [
    { tool: "create_task", summary: "Add “Call Sam”", status: "done", arguments: {} },
    { tool: "create_task", summary: "Add “Book flights”", status: "done", arguments: {} },
  ];
  const chat = { status: "idle", messages: [{ id: "u1", role: "user", content: "add", createdAt: "" }, proposal], plan };
  assert.equal(autoAppliedState(proposal, chat), "undo");
  // A later run or review: Undo waits (the server refuses it then).
  assert.equal(autoAppliedState(proposal, { ...chat, status: "running" }), "undoLater");
  assert.equal(autoAppliedState(proposal, { ...chat, status: "approval" }), "undoLater");
  // While its own changes apply it says so; a change that did not go in has no Undo.
  const applying = { ...chat, status: "running", plan: [plan[0], { ...plan[1], status: "pending" }] };
  assert.equal(autoAppliedState(proposal, applying), "applying");
  const partial = { ...chat, status: "failed", plan: [plan[0], { ...plan[1], status: "failed" }] };
  assert.equal(autoAppliedState(proposal, partial), "applied");
  // An older auto-applied card keeps "Applied" while a newer proposal applies.
  const newer = { ...proposal, id: "p2" };
  const later = { status: "running", messages: [...chat.messages, { id: "a0", role: "assistant", kind: "archive", content: "Previous changes", steps: plan, createdAt: "" }, newer], plan: [{ ...plan[0], status: "pending" }] };
  assert.equal(autoAppliedState(proposal, later), "undoLater");
  assert.equal(autoAppliedState({ ...proposal, autoApplied: false }, chat), "none");
  assert.deepEqual(appliedSteps(chat, proposal), plan);
  assert.equal(planSummaryHidden(chat), true);
  // Held proposals keep the review card.
  const held = { ...chat, status: "approval", messages: [chat.messages[0], { ...proposal, autoApplied: false }], plan: plan.map((s) => ({ ...s, status: "pending" })) };
  assert.equal(planSummaryHidden(held), false);

  // After Undo: the original plan is archived and the live plan is the undo.
  const undone = { ...proposal, undoneAt: "2026-11-09T10:00:00Z", undoMessageId: "n1" };
  const undoPlan = [{ tool: "delete_task", summary: "Remove “Call Sam”", status: "pending", arguments: {}, undo: true }];
  const after = {
    status: "queued",
    messages: [chat.messages[0], undone, { id: "a1", role: "assistant", kind: "archive", content: "Previous changes", steps: plan, createdAt: "" }, { id: "n1", role: "assistant", kind: "notice", content: "Undoing", createdAt: "" }],
    plan: undoPlan,
  };
  // The server marks it undone when Undo is asked: "Undoing" until the undo
  // plan applies, "Undo didn't finish" if it stops short.
  assert.equal(autoAppliedState(undone, after), "undoing");
  assert.equal(autoAppliedState(undone, { ...after, status: "failed" }), "undoFailed");
  assert.equal(autoAppliedState(undone, { ...after, status: "idle", plan: undoPlan.map((s) => ({ ...s, status: "done" })) }), "undone");
  assert.deepEqual(appliedSteps(after, undone), plan);
  // The card shows those steps, so the thread skips that archive.
  assert.deepEqual([...autoCardArchives(after)], ["a1"]);
  assert.equal(autoCardArchives(chat).size, 0);
  assert.equal(isUndoPlan(after.plan), true);
  assert.equal(planSummaryHidden(after), false);
});

test("the engine shows beside the model, and a run the new engine couldn't start offers Use classic", () => {
  assert.equal(engineLabel({ engine: "", runEngine: "agent" }), "New engine");
  assert.equal(engineLabel({ engine: "classic", runEngine: "classic" }), "Classic engine");
  assert.equal(engineLabel({ engine: "", runEngine: "classic" }), "");
  assert.equal(engineLabel({ engine: "", runEngine: "" }), "");
  assert.equal(offersUseClassic({ status: "failed", errorAction: "use_classic" }), true);
  assert.equal(offersUseClassic({ status: "failed", errorAction: "" }), false);
  assert.equal(offersUseClassic({ status: "running", errorAction: "use_classic" }), false);
});

// What the agent learned (phase 3, plan 9b.4): the chat chip and Keep /
// Discard card, "Don't learn from this chat", and the phone's Settings screens.
const learning = await import("../apps/mobile/lib/chat/learning.ts");
const { chatStreamMessage, followsLearning } = await import("../apps/mobile/lib/chat/agentRun.ts");
const { existsSync } = await import("node:fs");

const lev = (over = {}) => ({
  id: "ev1",
  kind: "skill",
  action: "created",
  subject: "bank-csv-import",
  before: "",
  after: "---\nname: bank-csv-import\n---\nRead the CSV",
  origin: "chat",
  conversationId: "c1",
  runId: "run1",
  botId: "",
  taintedSources: [],
  status: "applied",
  ledgerEntryId: "l1",
  pendingId: "",
  summary: "How to import a bank CSV",
  createdAt: "2026-11-11T10:00:00Z",
  updatedAt: "2026-11-11T10:00:00Z",
  ...over,
});
const reply = (over = {}) => ({ id: "m2", role: "assistant", content: "Done", createdAt: "2026-11-11T09:59:00Z", agentRun: "run1", engine: "agent", ...over });

test("the watch stream's learning frame refetches the open chat only; malformed frames are ignored", () => {
  const frame = { type: "learning", kind: "chat", id: "c1", document: { eventId: "ev1", status: "applied" } };
  assert.deepEqual(chatStreamMessage(frame), { type: "learning", id: "c1", eventId: "ev1", status: "applied" });
  assert.equal(chatStreamMessage({ type: "learning", id: "c1", document: { status: "applied" } }), null);
  assert.deepEqual(chatStreamMessage({ type: "changed", id: "c1" }), { type: "changed", id: "c1" });
  assert.equal(chatStreamMessage({ type: "hello", id: "" }), null);
  assert.equal(chatStreamMessage({ type: "delta", id: "c1", kind: "chat", document: { run: "r", offset: 0, text: "Hi" } }).type, "delta");
  assert.equal(learning.learningForChat("c1", { id: "c1" }), true);
  assert.equal(learning.learningForChat("c1", { id: "c2" }), false);
  // "" is a change outside any chat (Settings, the curator): not this chat's.
  assert.equal(learning.learningForChat("c1", { id: "" }), false);
  assert.equal(learning.learningForChat(null, { id: "" }), false);
});

test("a turn's applied change shows as the chip under its reply, with View and Undo", () => {
  const turn = learning.turnLearning([lev(), lev({ id: "other", runId: "run2" })], reply());
  assert.equal(turn.chip.label, "Learned: skill 'bank-csv-import' created");
  assert.equal(turn.chip.text, "Learned: skill 'bank-csv-import' created · View · Undo");
  assert.equal(turn.chip.note, null);
  assert.equal(turn.card, null);
  assert.deepEqual(learning.undoTargets(turn.chip), ["ev1"]);
  assert.equal(learning.viewHref(turn.chip), "/(app)/settings/learned/activity?event=ev1");
  // Two changes in one turn: Undo takes the newest back first, View opens the first.
  const two = learning.turnLearning([lev(), lev({ id: "ev2", action: "patched", createdAt: "2026-11-11T10:00:09Z" })], reply());
  assert.deepEqual(learning.undoTargets(two.chip), ["ev2", "ev1"]);
  assert.equal(learning.viewHref(two.chip), "/(app)/settings/learned/activity?event=ev1");
  // A user's message, or a reply with no run, carries nothing.
  assert.equal(learning.turnLearning([lev()], { role: "user", agentRun: "run1" }).chip, null);
  assert.equal(learning.turnLearning([lev()], reply({ agentRun: undefined })).chip, null);
  assert.equal(learning.turnLearning(undefined, reply()).chip, null);
});

test("a memory change says it applies from the next chat; About you opens About you", () => {
  const turn = learning.turnLearning([lev({ kind: "user", action: "added", subject: "user" }), lev({ id: "ev2", createdAt: "2026-11-11T10:01:00Z" })], reply());
  assert.equal(turn.chip.label, "Learned: About you added and 1 more");
  assert.equal(turn.chip.note, "applies from your next chat");
  assert.deepEqual(learning.undoTargets(turn.chip), ["ev2", "ev1"]); // newest first
  assert.equal(learning.viewHref(turn.chip), "/(app)/settings/learned/about");
});

test("once every change is undone the chip says Undone, with nothing to press", () => {
  const turn = learning.turnLearning([lev({ status: "undone" })], reply());
  assert.equal(turn.chip.text, "Undone");
  assert.deepEqual(turn.chip.actions, []);
  assert.deepEqual(learning.undoTargets(turn.chip), []);
  assert.equal(learning.viewHref(turn.chip), null);
});

test("a staged change waits on the Keep / Discard card, not the chip", () => {
  const staged = lev({ status: "staged", pendingId: "p1", action: "patched", subject: "flipkart-price-read", taintedSources: [{ kind: "web", tool: "web_extract" }] });
  const turn = learning.turnLearning([staged, lev({ id: "ev3", status: "staged", pendingId: "p2", kind: "memory", action: "added", subject: "memory" })], reply());
  assert.equal(turn.chip, null);
  assert.equal(turn.card.title, "Keep what Timely learned?");
  assert.equal(learning.cardMeta(turn.card), "Skill “flipkart-price-read” updated and 1 more");
  assert.equal(turn.card.why, "This chat read something from outside Timely, so it waits for you.");
  assert.deepEqual(learning.cardTargets(turn.card), ["p1", "p2"]);
  assert.equal(learning.diffHref(turn.card), "/(app)/settings/learned/waiting?pending=p1");
  // Kept: it moves to the chip; discarded: it leaves both.
  assert.equal(learning.turnLearning([{ ...staged, status: "kept" }], reply()).chip.label, "Learned: skill 'flipkart-price-read' updated");
  const gone = learning.turnLearning([{ ...staged, status: "discarded" }], reply());
  assert.equal(gone.chip, null);
  assert.equal(gone.card, null);
  // A bot's change says so.
  assert.equal(learning.turnLearning([{ ...staged, origin: "bot", botId: "b1" }], reply()).card.why, "A bot suggested this, so it waits for you.");
});

test("a run's learning shows once, under its last message; changes of runs with no message show at the end", () => {
  const messages = [
    { id: "m1", role: "user", agentRun: undefined },
    reply({ id: "m2" }),
    reply({ id: "m3" }),
    reply({ id: "m4", agentRun: "run9" }),
  ];
  assert.deepEqual([...learning.learningAnchors(messages)], ["m3", "m4"]);
  const loose = learning.looseLearning([lev(), lev({ id: "late", runId: "run-live", createdAt: "2026-11-11T10:05:00Z" })], messages);
  assert.deepEqual(loose.events.map((ev) => ev.id), ["late"]);
  assert.equal(loose.chip.label, "Learned: skill 'bank-csv-import' created");
  assert.equal(learning.looseLearning([lev()], messages).chip, null);
});

test("the chat follows its learning on the agent engine; Don't learn is offered only where it matters", () => {
  const chat = { messages: [reply()], runEngine: "agent", engine: "", sensitive: false, noLearning: false };
  assert.equal(followsLearning(chat, "classic"), true);
  assert.equal(followsLearning({ ...chat, messages: [], runEngine: "" }, "agent"), true);
  assert.equal(followsLearning({ ...chat, messages: [], runEngine: "" }, "classic"), false);
  assert.equal(followsLearning({ ...chat, sensitive: true }, "agent"), false);
  assert.equal(learning.offersDontLearn(chat, true, { learning: true }), true);
  assert.equal(learning.offersDontLearn(chat, true, { learning: false }), false);
  assert.equal(learning.offersDontLearn(chat, false, { learning: true }), false);
  assert.equal(learning.offersDontLearn({ ...chat, sensitive: true }, true, { learning: true }), false);
  assert.equal(learning.offersDontLearn(chat, true, undefined), false);
  // Already on: the switch stays so it can be turned back off.
  assert.equal(learning.offersDontLearn({ ...chat, noLearning: true }, false, { learning: false }), true);
  assert.equal(learning.DONT_LEARN, "Don't learn from this chat");
});

test("Settings → Agent's row counts learned and edited skills, About you and what waits", () => {
  const skills = [
    { source: "learned", archived: false },
    { source: "edited", archived: false },
    { source: "learned", archived: true },
    { source: "bundled", archived: false },
  ];
  assert.equal(learning.learnedSkillCount(skills), 2);
  assert.equal(learning.learnedRowMeta({ learning: true }, skills, 1), "2 skills · About you · 1 waiting");
  assert.equal(learning.learnedRowMeta({ learning: true }, [skills[0]], 0), "1 skill · About you");
  // Without the agent the row still says what it opens.
  assert.equal(learning.learnedRowMeta({ learning: true }, undefined, 0), "About you");
  assert.equal(learning.learnedRowMeta({ learning: false }, skills, 0), "Off");
  assert.equal(learning.learnedRowMeta({ learning: false }, skills, 2), "2 skills · About you · 2 waiting");
});

test("Activity rows say what changed, its status, when and where from; Undo only while in effect", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  assert.deepEqual(learning.activityRow(lev(), now), { title: "Skill “bank-csv-import” created", meta: "Learned · 2 h ago · from a chat" });
  assert.deepEqual(learning.activityRow(lev({ kind: "user", action: "replaced", origin: "user", status: "undone", createdAt: "2026-11-11T11:57:00Z" }), now), {
    title: "About you updated",
    meta: "Undone · 3 min ago · by you",
  });
  // the person's own change in effect is not something Timely "learned"
  assert.deepEqual(learning.activityRow(lev({ kind: "user", action: "added", origin: "user", status: "applied", createdAt: "2026-11-11T11:54:00Z" }), now), {
    title: "About you added",
    meta: "6 min ago · by you",
  });
  assert.equal(learning.canUndo({ status: "applied" }), true);
  assert.equal(learning.canUndo({ status: "kept" }), true);
  for (const status of ["staged", "blocked", "undone", "discarded"]) assert.equal(learning.canUndo({ status }), false);
  // the curator's "unused" note on a skill has no history entry: nothing to undo
  assert.equal(learning.canUndo({ status: "applied", kind: "skill", ledgerEntryId: "" }), false);
  assert.equal(learning.canUndo({ status: "applied", kind: "skill", ledgerEntryId: "led-1" }), true);
  assert.equal(learning.canUndo({ status: "applied", kind: "user", ledgerEntryId: "" }), true);
  assert.equal(learning.nextBefore([lev(), lev({ createdAt: "2026-11-10T00:00:00Z" })], 2), "2026-11-10T00:00:00Z");
  assert.equal(learning.nextBefore([lev()], 2), null);
});

test("a card with several staged changes is reviewed item by item, never kept with one tap", () => {
  const card = (ids) => ({ items: ids.map((pendingId) => ({ pendingId, line: `change ${pendingId}` })) });
  assert.equal(learning.reviewHref(card(["p1"])), null);
  assert.equal(learning.reviewHref(card(["p1", "p2"])), learning.WAITING_ROUTE);
  assert.equal(learning.reviewLabel(card(["p1", "p2", "p3"])), "Review 3 changes");
  assert.equal(learning.reviewHref(null), null);
});

test("About you's meter follows the edit, and Save needs a change that fits", () => {
  const store = { entries: ["I run a bakery"], used: 1370, limit: 1375 };
  // a new entry also adds the separator between entries ("\n§\n"), as the worker counts it
  assert.equal(learning.projectedBudget(store, "", "hi").text, "1,375 of 1,375");
  assert.equal(learning.canSaveEntry(store, "", "hi!"), false);
  assert.equal(learning.canSaveEntry({ entries: [], used: 0, limit: 3 }, "", "abc"), true);
  assert.equal(learning.projectedBudget(store, "I run a bakery", "I bake").text, "1,362 of 1,375");
  assert.equal(learning.projectedBudget(store, "", "0123456789").tone, "full");
  assert.equal(learning.canSaveEntry(store, "", "hi"), true);
  assert.equal(learning.canSaveEntry(store, "", "0123456789"), false);
  assert.equal(learning.canSaveEntry(store, "", "   "), false);
  assert.equal(learning.canSaveEntry(store, "I run a bakery", "I run a bakery "), false);
  assert.equal(learning.canSaveEntry(store, "I run a bakery", "I run a cafe"), true);
});

test("Waiting for you rows read the worker's items with the card's words", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const item = { pending_id: "p1", kind: "skill", subject: "flipkart-price-read", action: "patched", diff: "-old\n+new", origin: "chat", conversation_id: "c1", created_at: "2026-11-11T11:00:00Z" };
  assert.equal(learning.pendingMeta(item, now), "from a chat · 1 h ago");
  assert.equal(learning.pendingMeta({ ...item, summary: "Reads the deal price" }, now), "Reads the deal price · 1 h ago");
  const tainted = { ...item, reason: "tainted", tainted_sources: [{ kind: "web", tool: "web_extract" }] };
  assert.equal(learning.pendingWhy(tainted), "This chat read something from outside Timely, so it waits for you.");
  assert.equal(learning.pendingWhy({ ...item, origin: "bot" }), "A bot suggested this, so it waits for you.");
  // a clean chat stages for its own reasons, never "read something from outside"
  assert.equal(learning.pendingWhy({ ...item, reason: "skill_body" }), "These steps use tools that need your OK, so they wait for you.");
  assert.equal(learning.pendingWhy({ ...item, reason: "unattended" }), "This changes or removes something Timely already knows, so it waits for you.");
  assert.equal(learning.pendingWhy(item), "Timely waits for you before saving this.");
  assert.equal(learning.pendingAsEvent(item).pendingId, "p1");
});

test("every What Timely learned route the chip, card and Settings open is a screen", () => {
  const file = (route) => new URL(`../apps/mobile/app${route.split("?")[0]}${route.endsWith("learned") ? "/index" : ""}.tsx`, import.meta.url);
  for (const route of [learning.LEARNED_ROUTE, learning.ACTIVITY_ROUTE, learning.ABOUT_YOU_ROUTE, learning.WAITING_ROUTE]) {
    assert.ok(existsSync(file(route)), `${route} has no screen`);
  }
  assert.equal(learning.viewHref(learning.turnLearning([lev()], reply()).chip).split("?")[0], learning.ACTIVITY_ROUTE);
});

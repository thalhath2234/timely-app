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
  assert.equal(autoAppliedState(proposal, { status: "running" }), "waiting");
  assert.equal(autoAppliedState(proposal, { status: "approval" }), "waiting");
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
  assert.equal(autoAppliedState(undone, after), "undone");
  assert.deepEqual(appliedSteps(after, undone), plan);
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

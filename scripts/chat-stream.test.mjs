// The web app's live streams (apps/web/app/utils/api/chatStream.ts): one tab
// per browser holds GET /chats/watch (and GET /bots/watch, under its own lock)
// and shares it with the other tabs. A live agent run's reply arrives on the
// chat stream as `delta` events, which ReplyDrafts turns into the growing
// reply (Q-2.5). Since phase 3 it also carries `learning` events, which make
// the apps refetch what the agent learned; the chat's chip, Keep / Discard
// card and the Settings words come from apps/web/app/_components/chat/learningView.ts.
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CHAT_STREAM_LOCK, ReplyDrafts, parseSSE, startChatStream, startLiveStream } from "../apps/web/app/utils/api/chatStream.ts";
import {
  diffRows,
  learnedHref,
  learningAnchors,
  learnsInChat,
  looseLearning,
  memoryEditIndex,
  learningFollowed,
  skillOrigin,
  turnLearning,
  webSearchLine,
} from "../apps/web/app/_components/chat/learningView.ts";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A /chats/watch response the test writes frames into. */
function watchResponse() {
  let controller;
  const body = new ReadableStream({ start: (c) => (controller = c) });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    send: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

/** Web Locks with one holder at a time per name, like navigator.locks. */
function fakeLocks() {
  const tails = new Map();
  const names = [];
  return {
    names,
    request(name, { signal }, callback) {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(() =>
        signal.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : callback(),
      );
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

test("events are split off complete frames; keepalives and partial frames wait", () => {
  const first = parseSSE('event: hello\ndata: {"type":"hello"}\n\n: keepalive\n\nevent: changed\ndata: {"id":"chat_1"');
  assert.deepEqual(first.events, [{ event: "hello", data: '{"type":"hello"}' }]);
  const second = parseSSE(first.rest + "}\n\n");
  assert.deepEqual(second.events, [{ event: "changed", data: '{"id":"chat_1"}' }]);
  assert.equal(second.rest, "");
  assert.deepEqual(parseSSE(": keepalive\n\n").events, []);
});

test("one tab opens the stream and the others hear it through the channel", async () => {
  const locks = fakeLocks();
  const streams = [];
  const open = async () => {
    const stream = watchResponse();
    streams.push(stream);
    return stream.response;
  };
  const heard = { a: [], b: [] };
  const stopA = startChatStream((m) => heard.a.push(m), { open, locks, channel: new BroadcastChannel("t1") });
  await tick();
  const stopB = startChatStream((m) => heard.b.push(m), { open, locks, channel: new BroadcastChannel("t1") });
  await tick();
  assert.equal(streams.length, 1, "only one connection for two tabs");
  assert.deepEqual(heard.b, [{ type: "live", live: true }], "a tab that opens later learns the stream is up");

  streams[0].send('event: hello\ndata: {}\n\nevent: changed\ndata: {"type":"changed","kind":"chat","id":"chat_1"}\n\n');
  await tick();
  assert.deepEqual(heard.a, [{ type: "live", live: true }, { type: "changed", id: "chat_1" }]);
  assert.deepEqual(heard.b.at(-1), { type: "changed", id: "chat_1" });

  stopA();
  await tick();
  assert.equal(streams.length, 2, "the other tab takes the stream over");
  streams[1].send('event: changed\ndata: {"id":"chat_2"}\n\n');
  await tick();
  assert.deepEqual(heard.b.at(-1), { type: "changed", id: "chat_2" });
  stopB();
});

test("a dropped or refused stream reports not live and reconnects with growing waits", async () => {
  const waits = [];
  const answers = [() => new Response("no", { status: 502 }), () => new Response("no", { status: 401 })];
  let current;
  const open = async () => {
    const next = answers.shift();
    if (next) return next();
    current = watchResponse();
    return current.response;
  };
  const heard = [];
  const stop = startChatStream((m) => heard.push(m), { open, wait: async (ms) => void waits.push(ms) });
  await tick();
  assert.deepEqual(waits, [1000, 2000]);
  assert.deepEqual(heard, [{ type: "live", live: true }]);

  current.end();
  await tick();
  assert.deepEqual(heard.slice(1, 3), [{ type: "live", live: false }, { type: "live", live: true }], "reconnects after the server closes it");
  assert.equal(waits.at(-1), 1000, "a stream that got through starts the waits over");
  stop();
});

test("a stream under its own lock runs beside the chat stream, not instead of it", async () => {
  const locks = fakeLocks();
  const opened = [];
  const opener = (path) => async () => {
    const stream = watchResponse();
    opened.push({ path, stream });
    return stream.response;
  };
  const chat = [];
  const bots = [];
  const otherTab = [];
  const stopChat = startChatStream((m) => chat.push(m), { open: opener("/chats/watch"), locks });
  const stopBots = startLiveStream((m) => bots.push(m), {
    open: opener("/bots/watch"),
    locks,
    lock: "timely-bot-stream",
    channel: new BroadcastChannel("t-bots"),
  });
  await tick();
  assert.deepEqual(locks.names, [CHAT_STREAM_LOCK, "timely-bot-stream"], "the chat stream keeps its lock by default");
  assert.deepEqual(
    opened.map((o) => o.path),
    ["/chats/watch", "/bots/watch"],
    "holding the chat lock does not keep the bot stream from opening",
  );

  // A second tab's bot stream waits on the same lock and hears the first tab.
  const stopOther = startLiveStream((m) => otherTab.push(m), {
    open: opener("/bots/watch"),
    locks,
    lock: "timely-bot-stream",
    channel: new BroadcastChannel("t-bots"),
  });
  await tick();
  assert.equal(opened.length, 2, "one bot stream for two tabs");
  opened[1].stream.send('event: changed\ndata: {"type":"changed","kind":"bot","id":"bot_1"}\n\n');
  await tick();
  assert.deepEqual(bots.at(-1), { type: "changed", id: "bot_1" });
  assert.deepEqual(otherTab.at(-1), { type: "changed", id: "bot_1" });
  assert.equal(chat.filter((m) => m.type === "changed").length, 0, "a bot change never reaches the chat listener");

  stopBots();
  await tick();
  assert.deepEqual(opened.at(-1).path, "/bots/watch", "the other tab takes the bot stream over");
  assert.equal(opened.length, 3);
  stopOther();
  stopChat();
});

const deltaFrame = (id, run, offset, text) =>
  `event: delta\ndata: ${JSON.stringify({ type: "delta", kind: "chat", id, document: { run, offset, text } })}\n\n`;
const delta = (run, offset, text, id = "chat_1") => ({ type: "delta", id, run, offset, text });

describe("streamed reply deltas", () => {
  test("a delta frame reaches the listener as a delta message; malformed ones are dropped", async () => {
    let stream;
    const heard = [];
    const stop = startChatStream((m) => heard.push(m), {
      open: async () => (stream = watchResponse()).response,
    });
    await tick();
    stream.send(deltaFrame("chat_1", "run-1", 0, "Sure, "));
    stream.send('event: delta\ndata: {"id":"chat_1","document":{"run":"run-1","offset":"6","text":"x"}}\n\n');
    stream.send('event: delta\ndata: {"id":"chat_1"}\n\n');
    stream.send(deltaFrame("chat_1", "run-1", 6, "done."));
    await tick();
    assert.deepEqual(heard.slice(1), [delta("run-1", 0, "Sure, "), delta("run-1", 6, "done.")]);
    stop();
  });

  test("a chunk that starts where the draft ends is appended", () => {
    const drafts = new ReplyDrafts();
    assert.equal(drafts.delta(delta("run-1", 0, "Sure, ")), false);
    assert.equal(drafts.delta(delta("run-1", 6, "I added it.")), false);
    assert.deepEqual(drafts.get("chat_1"), { run: "run-1", text: "Sure, I added it.", chars: 17 });
  });

  test("a chunk that repeats text already there adds only what is new", () => {
    const drafts = new ReplyDrafts();
    drafts.delta(delta("run-1", 0, "Moved 3 "));
    assert.equal(drafts.delta(delta("run-1", 6, "3 tasks")), false, "an overlap needs no refetch");
    assert.equal(drafts.get("chat_1").text, "Moved 3 tasks");
    assert.equal(drafts.delta(delta("run-1", 2, "ved")), false, "a chunk wholly inside the draft changes nothing");
    assert.equal(drafts.get("chat_1").text, "Moved 3 tasks");
    // Offsets count code points, so an emoji is one character, as in Go.
    drafts.delta(delta("run-1", 13, " 🎉"));
    drafts.delta(delta("run-1", 14, "🎉 ok"));
    assert.deepEqual(drafts.get("chat_1"), { run: "run-1", text: "Moved 3 tasks 🎉 ok", chars: 18 });
  });

  test("a gap keeps the draft, asks for one refetch, and the fetched activity continues it", () => {
    let now = 0;
    const drafts = new ReplyDrafts(() => now);
    drafts.delta(delta("run-1", 0, "Hello"));
    assert.equal(drafts.delta(delta("run-1", 12, "there")), true, "a missed chunk refetches the chat");
    assert.equal(drafts.get("chat_1").text, "Hello", "the draft waits as it was");
    now = 400;
    assert.equal(drafts.delta(delta("run-1", 17, "!")), false, "one refetch covers a second of gaps");
    now = 1500;
    assert.equal(drafts.delta(delta("run-1", 18, "?")), true, "a gap a second later refetches again");

    // The refetched row's activity.draft (written at most once a second) has the missed text.
    drafts.seed("chat_1", { run: "run-1", draft: "Hello, friend, there!", lines: [] });
    assert.equal(drafts.get("chat_1").text, "Hello, friend, there!");
    assert.equal(drafts.delta(delta("run-1", 21, " Done.")), false, "deltas append again after the refetch");
    assert.equal(drafts.get("chat_1").text, "Hello, friend, there! Done.");

    drafts.seed("chat_1", { run: "run-1", draft: "Hello" });
    assert.equal(drafts.get("chat_1").text, "Hello, friend, there! Done.", "an older, shorter activity.draft never rewinds it");
  });

  test("a new run starts its own draft, and a row whose run ended clears it", () => {
    const drafts = new ReplyDrafts();
    let changes = 0;
    const off = drafts.subscribe(() => changes++);
    drafts.delta(delta("run-1", 0, "First"));
    drafts.delta(delta("run-2", 0, "Second"));
    assert.deepEqual(drafts.get("chat_1"), { run: "run-2", text: "Second", chars: 6 });
    drafts.seed("chat_1", {});
    assert.equal(drafts.get("chat_1"), null, "the final reply arrives as a changed row with no activity");
    assert.equal(changes, 3);
    off();
    drafts.delta(delta("run-3", 0, "x"));
    assert.equal(changes, 3, "an unsubscribed listener hears nothing");
  });

  test("the tab holding the stream relays deltas to the other tabs, which keep their own drafts", async () => {
    const locks = fakeLocks();
    const streams = [];
    const open = async () => {
      const stream = watchResponse();
      streams.push(stream);
      return stream.response;
    };
    const tabs = [new ReplyDrafts(), new ReplyDrafts()];
    const refetches = [[], []];
    const listen = (i) => (m) => {
      if (m.type === "delta" && tabs[i].delta(m)) refetches[i].push(m.id);
    };
    const stopA = startChatStream(listen(0), { open, locks, channel: new BroadcastChannel("t-delta") });
    await tick();
    const stopB = startChatStream(listen(1), { open, locks, channel: new BroadcastChannel("t-delta") });
    await tick();
    assert.equal(streams.length, 1, "one connection for both tabs");

    streams[0].send(deltaFrame("chat_1", "run-1", 0, "Plan"));
    streams[0].send(deltaFrame("chat_1", "run-1", 4, "ned your week."));
    await tick();
    for (const drafts of tabs) assert.equal(drafts.get("chat_1").text, "Planned your week.");

    // A chunk lost on the way is a gap in every tab, and each refetches.
    streams[0].send(deltaFrame("chat_1", "run-1", 40, "later"));
    await tick();
    assert.deepEqual(refetches, [["chat_1"], ["chat_1"]]);

    stopA();
    await tick();
    assert.equal(streams.length, 2, "the other tab takes the stream over");
    streams[1].send(deltaFrame("chat_1", "run-1", 18, " Done."));
    await tick();
    assert.equal(tabs[1].get("chat_1").text, "Planned your week. Done.");
    stopB();
  });
});

const learningFrame = (id, eventId, status) =>
  `event: learning\ndata: ${JSON.stringify({ type: "learning", kind: "chat", id, document: { eventId, status } })}\n\n`;

describe("learning events on the chat stream", () => {
  test("a learning frame reaches the listener, also with no chat id; malformed ones are dropped", async () => {
    let stream;
    const heard = [];
    const stop = startChatStream((m) => heard.push(m), {
      open: async () => (stream = watchResponse()).response,
    });
    await tick();
    stream.send(learningFrame("chat_1", "lev_1", "applied"));
    stream.send(learningFrame("", "lev_2", "undone"));
    stream.send('event: learning\ndata: {"type":"learning","id":"chat_1","document":{"status":"applied"}}\n\n');
    stream.send('event: learning\ndata: {"type":"changed","id":"chat_1","document":{"eventId":"x","status":"applied"}}\n\n');
    stream.send('event: learning\ndata: not json\n\n');
    stream.send('event: nudge\ndata: {"id":"chat_1"}\n\n');
    stream.send('event: changed\ndata: {"id":"chat_1"}\n\n');
    await tick();
    stop();
    assert.deepEqual(heard.slice(1), [
      { type: "learning", id: "chat_1", eventId: "lev_1", status: "applied" },
      { type: "learning", id: "", eventId: "lev_2", status: "undone" },
      { type: "changed", id: "chat_1" },
    ]);
  });

  test("the tab holding the stream relays learning events to the other tabs", async () => {
    const locks = fakeLocks();
    const streams = [];
    const open = async () => {
      const stream = watchResponse();
      streams.push(stream);
      return stream.response;
    };
    const heard = { a: [], b: [] };
    const stopA = startChatStream((m) => heard.a.push(m), { open, locks, channel: new BroadcastChannel("t-learning") });
    await tick();
    const stopB = startChatStream((m) => heard.b.push(m), { open, locks, channel: new BroadcastChannel("t-learning") });
    await tick();
    streams[0].send(learningFrame("chat_1", "lev_9", "staged"));
    await tick();
    stopA();
    stopB();
    const learned = (list) => list.filter((m) => m.type === "learning");
    assert.deepEqual(learned(heard.a), [{ type: "learning", id: "chat_1", eventId: "lev_9", status: "staged" }]);
    assert.deepEqual(learned(heard.b), learned(heard.a));
  });
});

let seq = 0;
const lev = (fields) => ({
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
  ledgerEntryId: "led_1",
  pendingId: "",
  summary: "",
  createdAt: `2026-11-11T10:00:${String(seq).padStart(2, "0")}Z`,
  updatedAt: "2026-11-11T10:00:00Z",
  ...fields,
});

describe("what a chat shows of what the agent learned", () => {
  test("a turn's learning goes after the last message its run wrote", () => {
    const messages = [
      { id: "u1" },
      { id: "p1", agentRun: "run_1" },
      { id: "a1", agentRun: "run_1" },
      { id: "u2" },
      { id: "a2", agentRun: "run_2" },
      { id: "c1" },
    ];
    assert.deepEqual([...learningAnchors(messages)].sort(), [
      [2, "run_1"],
      [4, "run_2"],
    ]);
    assert.equal(learningAnchors(undefined).size, 0);
    assert.equal(learningAnchors([{ id: "classic" }]).size, 0);
  });

  test("a clean turn gets the chip; a staged change gets the card; other runs stay out", () => {
    const events = [
      lev({}),
      lev({ status: "staged", pendingId: "pend_1", subject: "flipkart-price-read", action: "patched", summary: "Reads the sale price" }),
      lev({ runId: "run_2", subject: "other" }),
    ];
    const { chip, card } = turnLearning(events, "run_1");
    assert.equal(chip.text, "Learned: skill 'bank-csv-import' created · View · Undo");
    assert.equal(card.title, "Keep what Timely learned?");
    assert.deepEqual(
      card.items.map((i) => [i.pendingId, i.line, i.summary]),
      [["pend_1", "Skill “flipkart-price-read” updated", "Reads the sale price"]],
    );
    const none = turnLearning(events, "run_3");
    assert.equal(none.chip, null);
    assert.equal(none.card, null);
  });

  test("a stopped or failed run's changes show at the end of the chat", () => {
    // stop() leaves a cut reply and a Stopped notice with no agentRun; the run still learned.
    const messages = [{ id: "u1" }, { id: "a1", agentRun: "run_1" }, { id: "u2" }, { id: "cut", cut: true }, { id: "n1", kind: "notice" }];
    const events = [
      lev({}),
      lev({ runId: "run_stopped", kind: "user", subject: "user", action: "added", after: "Likes tea" }),
      lev({ runId: "run_stopped", status: "staged", pendingId: "pend_9", subject: "tea-order", action: "created" }),
    ];
    const loose = looseLearning(events, messages);
    assert.equal(loose.chip.label, "Learned: About you added");
    assert.equal(loose.card.items[0].pendingId, "pend_9");
    assert.deepEqual(looseLearning(events.slice(0, 1), messages), { chip: null, card: null });
    assert.deepEqual(looseLearning(undefined, messages), { chip: null, card: null });
  });

  test("an About you edit follows its entry's text through a refetch", () => {
    // Edit opened on B; A was removed elsewhere, so B moved up and C took its old place.
    assert.equal(memoryEditIndex(["B", "C"], "B"), 0);
    assert.equal(memoryEditIndex(["A", "C"], "B"), -1);
    assert.equal(memoryEditIndex(undefined, "B"), -1);
  });

  test("a chat on the New engine follows its learning before any reply carries a run", () => {
    assert.equal(learningFollowed({ engine: "agent", messages: [{ id: "u1" }] }, "classic"), true);
    assert.equal(learningFollowed({ engine: "classic", messages: [{ id: "a1", agentRun: "run_1" }] }, "classic"), true);
    assert.equal(learningFollowed({ engine: "classic", messages: [{ id: "a1" }] }, "agent"), false);
    assert.equal(learningFollowed(undefined, "agent"), false);
  });

  test("once every change is undone, the chip says Undone with no buttons", () => {
    const { chip } = turnLearning([lev({ status: "undone" })], "run_1");
    assert.equal(chip.text, "Undone");
    assert.deepEqual(chip.actions, []);
  });

  test("View opens the skill, About you or Notes in Settings", () => {
    assert.equal(learnedHref({ kind: "skill", subject: "bank csv/import" }), "/settings?tab=learned&skill=bank%20csv%2Fimport");
    assert.equal(learnedHref({ kind: "user", subject: "user" }), "/settings?tab=learned&part=about");
    assert.equal(learnedHref({ kind: "memory", subject: "memory" }), "/settings?tab=learned&part=notes");
  });

  test("Don't learn from this chat is offered only where the New engine runs", () => {
    assert.equal(learnsInChat(undefined, "agent"), false);
    assert.equal(learnsInChat({ engine: "classic", runEngine: "agent" }, "agent"), false);
    assert.equal(learnsInChat({ engine: "agent" }, "classic"), true);
    assert.equal(learnsInChat({ engine: "", runEngine: "agent" }, "classic"), true);
    assert.equal(learnsInChat({ engine: "", runEngine: "" }, "agent"), true);
    assert.equal(learnsInChat({ engine: "", runEngine: "classic" }, "classic"), false);
  });
});

describe("Settings: What Timely learned and web search", () => {
  test("a unified diff becomes coloured rows; file headers and the no-newline marker stay apart", () => {
    const rows = diffRows("--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1,2 +1,2 @@\n # CSV\n-old step\n+new step\n\\ No newline at end of file\n");
    assert.deepEqual(rows, [
      { kind: "file", text: "--- a/SKILL.md" },
      { kind: "file", text: "+++ b/SKILL.md" },
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "context", text: "# CSV" },
      { kind: "remove", text: "old step" },
      { kind: "add", text: "new step" },
    ]);
    assert.deepEqual(diffRows(""), []);
    // a new skill: every line added, its frontmatter's --- lines included
    assert.deepEqual(diffRows("--- /dev/null\n+++ tips/SKILL.md\n@@ -0,0 +1,3 @@\n+---\n+name: tips\n+---\n"), [
      { kind: "file", text: "--- /dev/null" },
      { kind: "file", text: "+++ tips/SKILL.md" },
      { kind: "hunk", text: "@@ -0,0 +1,3 @@" },
      { kind: "add", text: "---" },
      { kind: "add", text: "name: tips" },
      { kind: "add", text: "---" },
    ]);
    assert.deepEqual(diffRows("@@ -1 +1 @@\n----\n++++\n").map((r) => r.kind), ["hunk", "remove", "add"]);
  });

  test("a skill's provenance is its creating event: a chat link, or you", () => {
    const events = [
      lev({ subject: "csv", action: "patched", origin: "user", conversationId: "", createdAt: "2026-11-11T11:00:00Z" }),
      lev({ subject: "csv", action: "created", origin: "chat", conversationId: "chat_7", createdAt: "2026-11-11T09:00:00Z" }),
      lev({ subject: "mine", action: "edited", origin: "user", conversationId: "" }),
    ];
    assert.deepEqual(skillOrigin(events, "csv"), { label: "Learned in a chat", conversationId: "chat_7" });
    assert.deepEqual(skillOrigin(events, "mine"), { label: "You", conversationId: "" });
    assert.equal(skillOrigin(events, "unknown"), null);
    assert.equal(skillOrigin([lev({ kind: "memory", subject: "csv" })], "csv"), null);
  });

  test("web search names the provider's own search, the key in use, or asks for a key (Q-3.8)", () => {
    const backends = [{ id: "brave", label: "Brave Search", keyUrl: "https://brave.example", available: true }];
    assert.deepEqual(webSearchLine({ active: null, backends, usesProvider: true, providerCanSearch: true }, "Claude Code"), {
      label: "Web search",
      meta: "Uses Claude Code’s own search",
      tone: "ok",
      action: "Add a search key",
    });
    const keyed = webSearchLine(
      { active: { backend: "brave", keyHint: "••••a1b2" }, backends, usesProvider: false, providerCanSearch: true },
      "Claude Code",
    );
    assert.equal(keyed.label, "Search key");
    assert.equal(keyed.meta, "Brave Search · ••••a1b2");
    assert.equal(keyed.action, "Change");
    const cannot = webSearchLine({ active: null, backends, usesProvider: true, providerCanSearch: false }, "Ollama");
    assert.equal(cannot.tone, "warn");
    assert.match(cannot.meta, /Ollama can’t search the web/);
    assert.equal(webSearchLine(undefined, "").meta, "Needs a search key");
  });
});

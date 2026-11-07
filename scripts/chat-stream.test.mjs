// The web app's live streams (apps/web/app/utils/api/chatStream.ts): one tab
// per browser holds GET /chats/watch (and GET /bots/watch, under its own lock)
// and shares it with the other tabs.
import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_STREAM_LOCK, parseSSE, startChatStream, startLiveStream } from "../apps/web/app/utils/api/chatStream.ts";

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

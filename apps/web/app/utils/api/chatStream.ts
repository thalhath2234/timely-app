/**
 * The live stream of chat changes (GET /chats/watch, server-sent events).
 *
 * A browser keeps only six connections open to one address across all its
 * tabs, so one tab per browser holds the stream: the one that gets the
 * "timely-chat-stream" Web Lock. It passes every message to the other tabs
 * over a BroadcastChannel, and the next tab takes over when it closes. Where
 * Web Locks are missing each tab opens its own stream.
 */

export type ChatStreamMessage =
  | { type: "live"; live: boolean }
  | { type: "changed"; id: string };

type Locks = {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
};

type Channel = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
};

export type ChatStreamDeps = {
  /** Opens GET /chats/watch; must honour the signal. */
  open: (signal: AbortSignal) => Promise<Response>;
  locks?: Locks;
  channel?: Channel;
  /** Waits before reconnecting; rejects or returns early once aborted. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const CHAT_STREAM_LOCK = "timely-chat-stream";
const FIRST_RETRY = 1000;
const LAST_RETRY = 30_000;

type SSEEvent = { event: string; data: string };

/** Splits complete server-sent events off `text`; `rest` is the unfinished tail. */
export function parseSSE(text: string): { events: SSEEvent[]; rest: string } {
  const blocks = text.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SSEEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const at = line.indexOf(":");
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Starts listening; call the returned function to stop. */
export function startChatStream(
  onMessage: (message: ChatStreamMessage) => void,
  { open, locks, channel, wait = pause }: ChatStreamDeps,
): () => void {
  const stop = new AbortController();
  let leading = false;
  let live = false;

  const post = (message: unknown) => {
    try {
      channel?.postMessage(message);
    } catch {
      // closed
    }
  };
  const emit = (message: ChatStreamMessage) => {
    if (stop.signal.aborted) return;
    if (message.type === "live") live = message.live;
    onMessage(message);
    post(message);
  };

  channel?.addEventListener("message", (event) => {
    const message = event.data as ChatStreamMessage | { type: "ask" };
    if (message.type === "ask") {
      // A tab that just opened asks whether the stream is up.
      if (leading) post({ type: "live", live });
    } else if (!leading) onMessage(message);
  });

  // Reads one connection until it ends. Stopping cancels the read even where
  // aborting the request does not.
  async function read(body: NonNullable<Response["body"]>) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    const cancel = () => void reader.cancel().catch(() => {});
    stop.signal.addEventListener("abort", cancel);
    if (stop.signal.aborted) cancel();
    try {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const parsed = parseSSE(buffer + value);
        buffer = parsed.rest;
        for (const { event, data } of parsed.events) {
          if (event !== "changed") continue;
          try {
            const { id } = JSON.parse(data) as { id?: string };
            if (id) emit({ type: "changed", id });
          } catch {
            // ignore a malformed frame
          }
        }
      }
    } finally {
      stop.signal.removeEventListener("abort", cancel);
    }
  }

  async function stream() {
    leading = true;
    let retry = FIRST_RETRY;
    while (!stop.signal.aborted) {
      try {
        const response = await open(stop.signal);
        if (!response.ok || !response.body) throw new Error(`watch answered ${response.status}`);
        emit({ type: "live", live: true });
        retry = FIRST_RETRY;
        await read(response.body);
      } catch {
        // dropped, refused or aborted: the loop decides
      }
      if (live) emit({ type: "live", live: false });
      if (stop.signal.aborted) break;
      await wait(retry, stop.signal);
      retry = Math.min(retry * 2, LAST_RETRY);
    }
    leading = false;
  }

  if (locks)
    locks.request(CHAT_STREAM_LOCK, { signal: stop.signal }, stream).catch(() => {
      // aborted while another tab held the stream
    });
  else void stream();
  post({ type: "ask" });

  return () => {
    // The tab that takes over reports live again once it is connected.
    if (leading && live) post({ type: "live", live: false });
    stop.abort();
    channel?.close();
  };
}

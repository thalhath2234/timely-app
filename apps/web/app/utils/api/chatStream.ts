import { isLearningWatchEvent } from "@timely/contract/agentLearning";
import {
  applyDelta,
  draftFromActivity,
  type ChatActivity,
  type ReplyDraft,
} from "@timely/contract/agentChat";

/**
 * A live stream of changes (server-sent events): chats from GET /chats/watch,
 * and bots from GET /bots/watch. The chat stream also carries `delta` events,
 * the reply of a live agent run as it is written (ReplyDrafts keeps them).
 *
 * A browser keeps only six connections open to one address across all its
 * tabs, so one tab per browser holds each stream: the one that gets its Web
 * Lock ("timely-chat-stream" for chats). It passes every message to the other
 * tabs over a BroadcastChannel, and the next tab takes over when it closes.
 * Where Web Locks are missing each tab opens its own stream.
 */

export type LiveStreamMessage =
  | { type: "live"; live: boolean }
  | { type: "changed"; id: string }
  /** One chunk of a live run's reply; offset counts code points before it. */
  | { type: "delta"; id: string; run: string; offset: number; text: string }
  /**
   * The agent learned something, or the person decided on it: refetch the
   * chat's learning (id is the conversation, "" outside a chat) and the
   * Settings lists.
   */
  | { type: "learning"; id: string; eventId: string; status: string };

export type ChatStreamMessage = LiveStreamMessage;

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

export type LiveStreamDeps = {
  /** Opens the watch request; must honour the signal. */
  open: (signal: AbortSignal) => Promise<Response>;
  locks?: Locks;
  /** The Web Lock that picks the one tab holding this stream; each stream has its own. */
  lock?: string;
  channel?: Channel;
  /** Waits before reconnecting; rejects or returns early once aborted. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type ChatStreamDeps = LiveStreamDeps;

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

/** The frames a stream passes on; any other event name is ignored. */
const FRAMES = new Set(["changed", "delta", "learning"]);

/** The message a `changed`, `delta` or `learning` frame carries, or null when it is malformed. */
function readFrame(event: string, frame: unknown): LiveStreamMessage | null {
  if (event === "learning") {
    if (!isLearningWatchEvent(frame)) return null;
    return {
      type: "learning",
      id: frame.id,
      eventId: frame.document.eventId,
      status: frame.document.status,
    };
  }
  const body = (frame ?? {}) as {
    id?: unknown;
    document?: { run?: unknown; offset?: unknown; text?: unknown };
  };
  if (typeof body.id !== "string" || !body.id) return null;
  if (event === "changed") return { type: "changed", id: body.id };
  const doc = body.document;
  if (
    !doc ||
    typeof doc.run !== "string" ||
    typeof doc.offset !== "number" ||
    typeof doc.text !== "string"
  )
    return null;
  return {
    type: "delta",
    id: body.id,
    run: doc.run,
    offset: doc.offset,
    text: doc.text,
  };
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
export function startLiveStream(
  onMessage: (message: LiveStreamMessage) => void,
  { open, locks, lock = CHAT_STREAM_LOCK, channel, wait = pause }: LiveStreamDeps,
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
  const emit = (message: LiveStreamMessage) => {
    if (stop.signal.aborted) return;
    if (message.type === "live") live = message.live;
    onMessage(message);
    post(message);
  };

  channel?.addEventListener("message", (event) => {
    const message = event.data as LiveStreamMessage | { type: "ask" };
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
          if (!FRAMES.has(event)) continue;
          try {
            const message = readFrame(event, JSON.parse(data));
            if (message) emit(message);
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
    locks.request(lock, { signal: stop.signal }, stream).catch(() => {
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

/** The chat stream: the live stream under the chat lock. */
export const startChatStream = startLiveStream;

/** A gap refetches the chat at most this often while its deltas keep missing. */
const GAP_REFETCH = 1000;

/**
 * The reply each live agent run has written so far, one per chat, kept from
 * the stream's `delta` events (Q-2.5). A chunk that starts where the draft
 * ends is appended, one that repeats text drops the overlap, and one past
 * the end (a chunk was missed) asks for a refetch; the refetched chat's
 * activity.draft then continues it (`seed`). The final reply arrives as a
 * normal `changed` row, whose empty activity clears the draft.
 */
export class ReplyDrafts {
  private drafts = new Map<string, ReplyDraft>();
  private gaps = new Map<string, number>();
  private listeners = new Set<() => void>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(id: string): ReplyDraft | null {
    return this.drafts.get(id) ?? null;
  }

  /** Applies one delta; true when the chat should be refetched for a gap. */
  delta(message: Extract<LiveStreamMessage, { type: "delta" }>): boolean {
    const { id, run, offset, text } = message;
    const result = applyDelta(this.get(id), {
      type: "delta",
      kind: "chat",
      id,
      document: { run, offset, text },
    });
    this.set(id, result.draft);
    if (!result.refetch) {
      this.gaps.delete(id);
      return false;
    }
    const at = this.now();
    const last = this.gaps.get(id);
    if (last !== undefined && at - last < GAP_REFETCH) return false;
    this.gaps.set(id, at);
    return true;
  }

  /**
   * Takes a fetched chat's activity: a run that ended clears the draft, and
   * activity.draft replaces a shorter draft of the same run or one of an
   * earlier run (a late joiner, a reconnect, or the refetch after a gap).
   */
  seed(id: string, activity: ChatActivity | null | undefined) {
    const next = draftFromActivity(activity);
    const current = this.get(id);
    if (!next) {
      if (current) this.set(id, null);
      return;
    }
    if (!current || current.run !== next.run || next.chars > current.chars)
      this.set(id, next);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(id: string, draft: ReplyDraft | null) {
    const current = this.get(id);
    if (current === draft) return;
    if (draft) this.drafts.set(id, draft);
    else {
      this.drafts.delete(id);
      this.gaps.delete(id);
    }
    for (const listener of this.listeners) listener();
  }
}

import type { ChatDelta } from "@timely/contract/agentChat";
import { getToken } from "../auth/session";
import { getApiUrl, tunnelHeaders } from "./client";
import { readSSE, type StreamEvent } from "./watch";
import { isChatDelta } from "../chat/agentRun";

/**
 * What `GET /chats/watch` says to the open chat: the stream came up or went
 * down (`live`), a chat changed (refetch it), or one chunk of a live agent
 * run's reply (`delta`, Q-2.5).
 */
export type ChatStreamMessage =
  | { type: "live"; live: boolean }
  | { type: "changed"; id: string }
  | { type: "delta"; event: ChatDelta };

const FIRST_WAIT = 1000;
const MAX_WAIT = 15_000;

/**
 * Follows `GET /chats/watch` with Bearer auth until `signal` aborts, and
 * opens it again after a drop (1 s, doubling to 15 s). Where the fetch body
 * can't be read as a stream it reports `live: false` once and stops, so the
 * open chat keeps today's polling instead.
 */
export function watchChats(onMessage: (message: ChatStreamMessage) => void, signal: AbortSignal) {
  let live = false;
  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    if (!signal.aborted) onMessage({ type: "live", live: next });
  };

  void (async () => {
    let wait = FIRST_WAIT;
    while (!signal.aborted) {
      try {
        const baseUrl = await getApiUrl();
        const token = await getToken();
        const headers: Record<string, string> = { Accept: "text/event-stream", ...tunnelHeaders(baseUrl) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${baseUrl}/chats/watch`, { headers, signal });
        if (!response.ok) throw new Error(`chat stream answered ${response.status}`);
        if (!response.body || typeof response.body.getReader !== "function") {
          setLive(false);
          return;
        }
        await readSSE<StreamEvent & { document?: unknown }>(
          response.body,
          (event) => {
            if (event.type === "hello") {
              wait = FIRST_WAIT;
              setLive(true);
            } else if (isChatDelta(event)) {
              onMessage({ type: "delta", event });
            } else if (event.type === "changed" && event.id) {
              onMessage({ type: "changed", id: event.id });
            }
          },
          signal,
        );
      } catch {
        // Dropped, refused or offline: wait and open it again.
      }
      setLive(false);
      if (signal.aborted) return;
      await delay(wait, signal);
      wait = Math.min(wait * 2, MAX_WAIT);
    }
  })();
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

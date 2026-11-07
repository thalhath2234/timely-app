import { getToken } from "../auth/session";
import { getApiUrl, tunnelHeaders } from "./client";
import { readSSE } from "./watch";

/**
 * What the bots stream says: it came up or went down (`live`), or one bot
 * changed (a check finished, an alert fired, it was edited).
 */
export type BotStreamMessage = { type: "live"; live: boolean } | { type: "changed"; id: string };

let streaming = false;

/** True while `GET /bots/watch` is open, so the bots queries need not poll. */
export function isBotStreaming() {
  return streaming;
}

const FIRST_WAIT = 1000;
const MAX_WAIT = 30_000;

/**
 * Follows `GET /bots/watch` with Bearer auth until `signal` aborts, and
 * opens it again after a drop (1 s, doubling to 30 s). Where the fetch body
 * can't be read as a stream it gives up at once and stays down, so the bots
 * queries keep polling instead.
 */
export function watchBots(onMessage: (message: BotStreamMessage) => void, signal: AbortSignal) {
  const setLive = (live: boolean) => {
    if (streaming === live) return;
    streaming = live;
    // After a stop nobody is listening any more.
    if (!signal.aborted) onMessage({ type: "live", live });
  };

  void (async () => {
    let wait = FIRST_WAIT;
    while (!signal.aborted) {
      try {
        const baseUrl = await getApiUrl();
        const token = await getToken();
        const headers: Record<string, string> = { Accept: "text/event-stream", ...tunnelHeaders(baseUrl) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${baseUrl}/bots/watch`, { headers, signal });
        if (!response.ok) throw new Error(`bots stream answered ${response.status}`);
        if (!response.body || typeof response.body.getReader !== "function") {
          setLive(false);
          return;
        }
        await readSSE(
          response.body,
          (event) => {
            if (event.type === "hello") {
              wait = FIRST_WAIT;
              setLive(true);
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

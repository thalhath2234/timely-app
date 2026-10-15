import { getToken } from "../auth/session";
import { getApiUrl, tunnelHeaders } from "./client";

export type WatchEvent<T> = {
  type: "hello" | "updated" | "deleted";
  kind?: string;
  id: string;
  updatedAt?: string;
  document?: T;
};

/**
 * Follows a file's watch stream (`/docs/:id/watch`, `/sheets/:id/watch`) with
 * cookie-less Bearer auth. Falls back to polling `load` every few seconds when
 * the response body can't be read as a stream. Returns a function that stops it.
 */
export function watchStream<T extends { updatedAt: string }>(
  path: string,
  kind: string,
  id: string,
  load: () => Promise<T>,
  onEvent: (event: WatchEvent<T>) => void,
) {
  const controller = new AbortController();
  let stopped = false;

  const stop = () => {
    stopped = true;
    controller.abort();
  };

  void (async () => {
    try {
      const baseUrl = await getApiUrl();
      const token = await getToken();
      const headers: Record<string, string> = { Accept: "text/event-stream", ...tunnelHeaders(baseUrl) };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(`${baseUrl}${path}`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body || typeof response.body.getReader !== "function") {
        throw new Error("sse unavailable");
      }
      await readSSE(response.body, onEvent, controller.signal);
    } catch {
      if (stopped) return;
      await poll(kind, id, load, onEvent, controller.signal);
    }
  })();

  return stop;
}

async function readSSE<T>(body: ReadableStream<Uint8Array>, onEvent: (event: WatchEvent<T>) => void, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as WatchEvent<T>;
        onEvent({ ...parsed, type: parsed.type || (eventName as WatchEvent<T>["type"]) || "updated" });
      } catch {
        // ignore
      }
      eventName = "";
    }
  }
}

async function poll<T extends { updatedAt: string }>(
  kind: string,
  id: string,
  load: () => Promise<T>,
  onEvent: (event: WatchEvent<T>) => void,
  signal: AbortSignal,
) {
  let updatedAt = "";
  while (!signal.aborted) {
    try {
      const file = await load();
      if (updatedAt && file.updatedAt !== updatedAt) {
        onEvent({ type: "updated", kind, id, updatedAt: file.updatedAt, document: file });
      }
      updatedAt = file.updatedAt;
    } catch {
      // keep polling through transient errors
    }
    await delay(3000, signal);
  }
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

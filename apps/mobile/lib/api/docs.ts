import type { Doc, DocContent } from "../types";
import type { CreateDocPayload, UpdateDocPayload as WireUpdateDocPayload } from "@timely/contract/documents";
import { getToken } from "../auth/session";
import { isRichContentEmpty } from "../richText";
import { api, getApiUrl, tunnelHeaders, unwrap } from "./client";
import { clearNulls, type Clearable } from "./clearable";

export type { CreateDocPayload };

const CLEARABLE_DOC_FIELDS = ["parentId", "projectId"] as const;

/** `UpdateDocPayload` from the contract, plus `null` meaning "clear" on `parentId` and `projectId`. */
export type UpdateDocPayload = Clearable<WireUpdateDocPayload, (typeof CLEARABLE_DOC_FIELDS)[number]>;

export type DocWatchEvent = {
  type: "hello" | "updated" | "deleted";
  kind?: string;
  id: string;
  updatedAt?: string;
  document?: Doc;
};

export function getDocs() {
  return api<Doc[]>("/docs");
}

export function getDoc(id: string) {
  return api<Doc>(`/docs/${id}`);
}

export async function createDoc(data: CreateDocPayload = {}) {
  const res = await api<Doc | { document: Doc }>("/docs", { method: "POST", body: data });
  return unwrap(res, "document");
}

export async function updateDoc(id: string, data: UpdateDocPayload) {
  const res = await api<Doc | { document: Doc }>(`/docs/${id}`, {
    method: "PUT",
    body: clearNulls<WireUpdateDocPayload>(data, CLEARABLE_DOC_FIELDS),
  });
  const saved = unwrap(res, "document");
  if (data.content && !isRichContentEmpty(data.content) && isRichContentEmpty(saved.content)) {
    throw new Error("Document body was not persisted");
  }
  return saved;
}

/** SSE stream with cookie-less Bearer auth. Falls back to polling if the body is not readable. */
export function watchDoc(id: string, onEvent: (event: DocWatchEvent) => void) {
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

      const response = await fetch(`${baseUrl}/docs/${id}/watch`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body || typeof response.body.getReader !== "function") {
        throw new Error("sse unavailable");
      }
      await readSSE(response.body, onEvent, controller.signal);
    } catch {
      if (stopped) return;
      await pollDoc(id, onEvent, controller.signal);
    }
  })();

  return stop;
}

async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DocWatchEvent) => void,
  signal: AbortSignal,
) {
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
        const parsed = JSON.parse(data) as DocWatchEvent;
        onEvent({ ...parsed, type: parsed.type || (eventName as DocWatchEvent["type"]) || "updated" });
      } catch {
        // ignore
      }
      eventName = "";
    }
  }
}

async function pollDoc(
  id: string,
  onEvent: (event: DocWatchEvent) => void,
  signal: AbortSignal,
) {
  let updatedAt = "";
  while (!signal.aborted) {
    try {
      const doc = await getDoc(id);
      if (updatedAt && doc.updatedAt !== updatedAt) {
        onEvent({ type: "updated", kind: "doc", id, updatedAt: doc.updatedAt, document: doc });
      }
      updatedAt = doc.updatedAt;
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

export function deleteDoc(id: string) {
  return api<void>(`/docs/${id}`, { method: "DELETE" });
}

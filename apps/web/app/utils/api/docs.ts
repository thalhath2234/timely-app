import { Doc, DocContent } from "@/app/_types/types";
import { isRichContentEmpty } from "@/app/utils/richText";
import { apiFetch, apiUrl } from "./client";


export type DocWatchEvent = {
  type: "hello" | "updated" | "deleted";
  kind?: string;
  id: string;
  updatedAt?: string;
  document?: Doc;
};

export interface CreateDocPayload {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string | null;
  workspaceId?: string;
  projectId?: string | null;
}

export interface UpdateDocPayload {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string | null;
  projectId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
  order?: number;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getDocs(): Promise<Doc[]> {
  const response = await apiFetch("/docs", { credentials: "include" });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch docs"));
  }

  return response.json();
}

export async function getDoc(id: string): Promise<Doc> {
  const response = await apiFetch(`/docs/${id}`, { credentials: "include" });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch doc"));
  }

  return response.json();
}

export async function createDoc(data: CreateDocPayload = {}): Promise<Doc> {
  const response = await apiFetch("/docs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create doc"));
  }

  const resData = await response.json();
  return resData.document ?? resData;
}

export async function updateDoc(
  id: string,
  data: UpdateDocPayload,
): Promise<Doc> {
  const response = await apiFetch(`/docs/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update doc"));
  }

  const resData = await response.json();
  const saved: Doc = resData.document ?? resData;
  if (
    data.content &&
    !isRichContentEmpty(data.content) &&
    isRichContentEmpty(saved.content)
  ) {
    throw new Error("Document body was not persisted");
  }
  return saved;
}

/** SSE last-write-wins stream. Cookie session is sent via withCredentials. */
export function watchDoc(id: string, onEvent: (event: DocWatchEvent) => void) {
  const source = new EventSource(apiUrl(`/docs/${id}/watch`), {
    withCredentials: true,
  });

  const handle = (fallback: DocWatchEvent["type"]) => (ev: MessageEvent) => {
    try {
      const data = JSON.parse(String(ev.data)) as DocWatchEvent;
      onEvent({ ...data, type: data.type || fallback });
    } catch {
      // ignore a malformed frame
    }
  };

  source.addEventListener("hello", handle("hello"));
  source.addEventListener("updated", handle("updated"));
  source.addEventListener("deleted", handle("deleted"));
  source.onmessage = handle("updated");

  return () => source.close();
}

export async function deleteDoc(id: string): Promise<void> {
  const response = await apiFetch(`/docs/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete doc"));
  }
}

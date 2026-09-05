import { Doc, DocContent } from "@/app/_types/types";

const DOCS_URL = "http://localhost:8080/docs";

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
  const response = await fetch(DOCS_URL, { credentials: "include" });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch docs"));
  }

  return response.json();
}

export async function getDoc(id: string): Promise<Doc> {
  const response = await fetch(`${DOCS_URL}/${id}`, { credentials: "include" });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch doc"));
  }

  return response.json();
}

export async function createDoc(data: CreateDocPayload = {}): Promise<Doc> {
  const response = await fetch(DOCS_URL, {
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
  const response = await fetch(`${DOCS_URL}/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update doc"));
  }

  const resData = await response.json();
  return resData.document ?? resData;
}

export async function deleteDoc(id: string): Promise<void> {
  const response = await fetch(`${DOCS_URL}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete doc"));
  }
}

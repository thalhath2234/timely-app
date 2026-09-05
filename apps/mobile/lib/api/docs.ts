import type { Doc, DocContent } from "../types";
import { api, unwrap } from "./client";

export type CreateDocPayload = {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string | null;
  workspaceId?: string;
  projectId?: string | null;
};

export type UpdateDocPayload = {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string | null;
  projectId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
  order?: number;
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
  const res = await api<Doc | { document: Doc }>(`/docs/${id}`, { method: "PUT", body: data });
  return unwrap(res, "document");
}

export function deleteDoc(id: string) {
  return api<void>(`/docs/${id}`, { method: "DELETE" });
}

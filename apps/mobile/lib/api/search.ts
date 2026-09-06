import { ApiError, api } from "./client";

export type SearchKind = "task" | "project" | "doc" | "sheet" | "event" | string;

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  score?: number;
  content?: string;
};

export async function searchItems(query: string, semantic = true): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ q: trimmed });
  if (semantic) params.set("mode", "semantic");
  try {
    const data = await api<SearchHit[] | { hits: SearchHit[] }>(`/search?${params.toString()}`);
    return Array.isArray(data) ? data : data.hits ?? [];
  } catch (error) {
    if (semantic && error instanceof ApiError && error.status === 503) {
      return searchItems(trimmed, false);
    }
    throw error;
  }
}

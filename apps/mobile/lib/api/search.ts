import { api } from "./client";

export type SearchKind = "task" | "project" | "doc" | "sheet" | "event" | string;

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  score?: number;
  content?: string;
};

/**
 * Hybrid by default: the API fuses keyword and embedding hits and degrades
 * to keyword-only on its own when no embedding provider is configured.
 * Pass `semantic = false` to force the plain keyword path.
 */
export async function searchItems(query: string, semantic = true): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({ q: trimmed });
  if (semantic) params.set("mode", "semantic");
  const data = await api<SearchHit[] | { hits: SearchHit[] }>(`/search?${params.toString()}`);
  const hits = Array.isArray(data) ? data : data.hits ?? [];
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (!hit.id || seen.has(key) || seen.has(hit.id)) return false;
    seen.add(key);
    seen.add(hit.id);
    return true;
  });
}

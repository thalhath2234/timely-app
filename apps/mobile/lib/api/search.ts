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
  return dedupeHits(Array.isArray(data) ? data : data.hits ?? []);
}

/** Drops hits without an ID and repeats of the same item. */
function dedupeHits(hits: SearchHit[], seen = new Set<string>()): SearchHit[] {
  return hits.filter((hit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (!hit.id || seen.has(key) || seen.has(hit.id)) return false;
    seen.add(key);
    seen.add(hit.id);
    return true;
  });
}

export type SmartCategory = "doc" | "sheet" | "task" | "project" | "event";

export type SmartSearch = {
  /** null: Smart suggestions didn't answer, keep the plain order. */
  hits: SearchHit[] | null;
  /** Clear misses the model moved out of `hits`. */
  hidden: SearchHit[];
  /** The kind of item the person most likely wants. */
  category?: SmartCategory;
  /** Set when the query reads like a command ("make a budget sheet"). */
  create?: { kind: SmartCategory; title: string };
  /** The phone's saved view the query asks for ("what's overdue"). */
  view?: { id: string; name: string };
  logId?: string;
};

/**
 * The semantic results reordered by Smart suggestions (Jev). Slow (up to a
 * few seconds), so callers show plain results first. Comes back with
 * `hits: null` when Smart suggestions are off or unsure.
 */
export async function smartSearch(query: string): Promise<SmartSearch> {
  const trimmed = query.trim();
  if (!trimmed) return { hits: null, hidden: [] };
  // client=phone: a saved view pick comes from the phone's own views.
  const params = new URLSearchParams({ q: trimmed, client: "phone" });
  const data = await api<{
    hits?: SearchHit[] | null;
    hidden?: SearchHit[] | null;
    category?: SmartCategory;
    create?: { kind: SmartCategory; title: string } | null;
    view?: { id: string; name: string } | null;
    logId?: string;
  }>(`/search/smart?${params.toString()}`);
  // One seen-set across both lists so a hidden item never repeats a kept one.
  const seen = new Set<string>();
  const hits = Array.isArray(data?.hits) ? dedupeHits(data.hits, seen) : null;
  const hidden = Array.isArray(data?.hidden) ? dedupeHits(data.hidden, seen) : [];
  return {
    hits,
    hidden,
    category: data?.category || undefined,
    create: data?.create?.kind && data.create.title?.trim() ? { kind: data.create.kind, title: data.create.title.trim() } : undefined,
    view: data?.view?.id && data.view.name?.trim() ? { id: data.view.id, name: data.view.name.trim() } : undefined,
    logId: data?.logId,
  };
}

export type RelatedKind = "task" | "project" | "doc" | "sheet";

export type RelatedItem = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet?: string;
};

/** Up to five items related to one item; empty when off, unsure or not indexed. */
export async function relatedItems(kind: RelatedKind, id: string): Promise<RelatedItem[]> {
  if (!id) return [];
  const params = new URLSearchParams({ kind, id });
  const data = await api<RelatedItem[] | null>(`/search/related?${params.toString()}`);
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data.filter((item) => {
    if (!item?.id || item.id === id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

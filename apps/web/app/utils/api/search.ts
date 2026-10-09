import { apiFetch } from "./client";

export type SearchKind = "task" | "project" | "doc" | "sheet" | "event" | string;

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  score?: number;
  content?: string;
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Hybrid by default: the API fuses keyword and embedding hits and degrades
 * to keyword-only on its own when no embedding provider is configured.
 * Pass `semantic = false` to force the plain keyword path.
 */
export async function searchItems(
  query: string,
  semantic = true,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ q: trimmed });
  if (semantic) params.set("mode", "semantic");

  const response = await apiFetch(`/search?${params.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Search failed"));
  }

  const data = await response.json();
  const hits: SearchHit[] = Array.isArray(data) ? data : data?.hits ?? [];
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (!hit.id || seen.has(key) || seen.has(hit.id)) return false;
    seen.add(key);
    seen.add(hit.id);
    return true;
  });
}

/** What smart suggestions (Jev) make of a search. `hits` is null when Jev
 * did not answer: keep the plain order. */
export type SmartSearch = {
  hits: SearchHit[] | null;
  hidden?: SearchHit[];
  category?: "doc" | "sheet" | "task" | "project" | "event";
  create?: { kind: "doc" | "sheet" | "task" | "project" | "event"; title: string };
  logId?: string;
};

export async function smartSearch(query: string): Promise<SmartSearch> {
  const params = new URLSearchParams({ q: query.trim() });
  const response = await apiFetch(`/search/smart?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Search failed"));
  }
  return response.json();
}

export type RelatedItem = {
  kind: "task" | "project" | "doc" | "sheet";
  id: string;
  title: string;
  snippet?: string;
};

/** Items Jev confirms are about the same thing; [] when it is off. */
export async function relatedItems(kind: RelatedItem["kind"], id: string): Promise<RelatedItem[]> {
  const params = new URLSearchParams({ kind, id });
  const response = await apiFetch(`/search/related?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't load related items"));
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

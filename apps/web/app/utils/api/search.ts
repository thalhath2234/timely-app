const SEARCH_URL = "http://localhost:8080/search";

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

export async function searchItems(
  query: string,
  semantic = true,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ q: trimmed });
  if (semantic) params.set("mode", "semantic");

  const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    credentials: "include",
  });

  if (response.status === 503 && semantic) {
    return searchItems(trimmed, false);
  }

  if (!response.ok) {
    throw new Error(await readError(response, "Search failed"));
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data?.hits ?? [];
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { relatedItems, searchItems, smartSearch, type RelatedItem } from "@/app/utils/api/search";
import { useDecisions } from "@/app/utils/hooks/decisions";

export function useSearch(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  const result = useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => searchItems(trimmed),
    enabled: trimmed.length > 0,
  });

  return { ...result, query: trimmed };
}

/** Jev's take on an already-debounced query. Nothing is requested while smart
 * suggestions are off, so the palette looks like it always did. */
export function useSmartSearch(query: string) {
  const on = useDecisions().data?.available ?? false;
  const trimmed = query.trim();
  const result = useQuery({
    queryKey: ["search-smart", trimmed],
    queryFn: () => smartSearch(trimmed),
    enabled: on && trimmed.length >= 2,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return { ...result, query: trimmed };
}

export function useRelated(kind: RelatedItem["kind"], id: string | undefined) {
  const on = useDecisions().data?.available ?? false;
  return useQuery({
    queryKey: ["search-related", kind, id],
    queryFn: () => relatedItems(kind, id!),
    enabled: on && Boolean(id),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { relatedItems, searchItems, smartSearch, type RelatedItem } from "@/app/utils/api/search";
import { relatedRefetchInterval, relatedStaleTime } from "@timely/contract/smartSearch";
import { useDecisions } from "@/app/utils/hooks/decisions";

export function useSearch(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();
  const enabled = trimmed.length > 0;

  // Keyword hits are ready in milliseconds; the semantic ones wait on an
  // embedding (up to a few seconds when the provider is slow). Keyword hits
  // show first and the semantic answer replaces them when it arrives.
  const semantic = useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => searchItems(trimmed),
    enabled,
  });
  const keyword = useQuery({
    queryKey: ["search", "keyword", trimmed],
    queryFn: () => searchItems(trimmed, false),
    enabled,
  });
  const data = semantic.data ?? keyword.data;
  // No keyword hits is not "no results" while the semantic ones may still find some.
  const waitingForSemantic = semantic.isFetching && !semantic.data && !keyword.data?.length;

  return {
    data,
    // Fetching with nothing to show yet.
    isFetching: (!data && (semantic.isFetching || keyword.isFetching)) || waitingForSemantic,
    isError: semantic.isError && keyword.isError,
    query: trimmed,
  };
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
  // A disabled query keeps its cached answer: one from before smart
  // suggestions went off is not shown.
  return { ...result, data: on ? result.data : undefined, query: trimmed };
}

/** Items related to one item, while smart suggestions are on. An empty list
 * is asked again shortly: an item saved a moment ago is not indexed yet. */
export function useRelated(kind: RelatedItem["kind"], id: string | undefined) {
  const on = useDecisions().data?.available ?? false;
  const result = useQuery({
    queryKey: ["search-related", kind, id],
    queryFn: () => relatedItems(kind, id!),
    enabled: on && Boolean(id),
    staleTime: (query) => relatedStaleTime(query.state),
    refetchInterval: (query) => relatedRefetchInterval(query.state),
    retry: false,
  });
  return on ? result : ({ ...result, data: undefined } as typeof result);
}

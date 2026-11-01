import { useQuery } from "@tanstack/react-query";
import { SEARCH_DEBOUNCE_MS, SEARCH_SETTLE_MS, searchQueryText } from "@timely/contract/searchQuery";
import { relatedItems, searchItems, smartSearch, type RelatedItem } from "@/app/utils/api/search";
import { relatedRefetchInterval, relatedStaleTime } from "@timely/contract/smartSearch";
import { useDecisions } from "@/app/utils/hooks/decisions";
import { useSettled } from "@/app/utils/hooks/useSettled";

/** `query` is what the person typed; `settled` is the same words once they
 * have stopped changing (see searchQuery.ts), for the searches that cost a
 * model call. */
export function useSearch(query: string) {
  const trimmed = searchQueryText(useSettled(query, SEARCH_DEBOUNCE_MS));
  const settled = searchQueryText(useSettled(query, SEARCH_SETTLE_MS));
  const enabled = trimmed.length > 0;
  const semanticNow = enabled && settled === trimmed;

  // Keyword hits are ready in milliseconds; the semantic ones wait on an
  // embedding (up to a few seconds when the provider is slow), so they are
  // asked once the typing settles, and a newer search drops an older one.
  // Keyword hits show first and the semantic answer replaces them.
  const semantic = useQuery({
    queryKey: ["search", settled],
    queryFn: ({ signal }) => searchItems(settled, true, signal),
    enabled: semanticNow,
  });
  const keyword = useQuery({
    queryKey: ["search", "keyword", trimmed],
    queryFn: () => searchItems(trimmed, false),
    enabled,
  });
  const semanticData = semanticNow ? semantic.data : undefined;
  const data = semanticData ?? keyword.data;
  // No keyword hits is not "no results" while the semantic ones may still find some.
  const waitingForSemantic = enabled && !semanticData && (!semanticNow || semantic.isFetching) && !keyword.data?.length;

  return {
    data,
    // Fetching with nothing to show yet.
    isFetching: (!data && (semantic.isFetching || keyword.isFetching)) || waitingForSemantic,
    isError: semanticNow && semantic.isError && keyword.isError,
    query: trimmed,
    settled,
  };
}

/** Smart suggestions' take on a settled query (useSearch's `settled`). Nothing is
 * requested while smart suggestions are off, so the palette looks like it
 * always did. An answer without their order (they did not answer) is asked
 * again the next time the same words are searched. */
export function useSmartSearch(query: string) {
  const on = useDecisions().data?.available ?? false;
  const trimmed = query.trim();
  const result = useQuery({
    queryKey: ["search-smart", trimmed],
    queryFn: ({ signal }) => smartSearch(trimmed, signal),
    enabled: on && trimmed.length >= 2,
    staleTime: (q) => (q.state.data?.hits ? 5 * 60 * 1000 : 0),
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
    queryFn: ({ signal }) => relatedItems(kind, id!, signal),
    enabled: on && Boolean(id),
    staleTime: (query) => relatedStaleTime(query.state),
    refetchInterval: (query) => relatedRefetchInterval(query.state),
    retry: false,
  });
  return on ? result : ({ ...result, data: undefined } as typeof result);
}

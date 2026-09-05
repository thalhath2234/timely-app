import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchItems } from "@/app/utils/api/search";

export function useSearch(query: string) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => searchItems(trimmed),
    enabled: trimmed.length > 0,
  });
}

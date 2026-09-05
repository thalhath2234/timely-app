"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useSearch } from "@/app/utils/hooks/search";
import type { SearchHit, SearchKind } from "@/app/utils/api/search";
import { cn } from "@/app/utils/cn";

const KIND_LABEL: Record<string, string> = {
  task: "Task",
  project: "Project",
  doc: "Doc",
  sheet: "Sheet",
  event: "Event",
};

function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case "task":
      return `/tasks?taskId=${encodeURIComponent(hit.id)}`;
    case "project":
      return `/tasks?projectId=${encodeURIComponent(hit.id)}`;
    case "doc":
      return `/docs/${encodeURIComponent(hit.id)}`;
    case "sheet":
      return `/sheets/${encodeURIComponent(hit.id)}`;
    case "event":
      return "/calendar";
    default:
      return "/";
  }
}

export default function SearchModal() {
  const router = useRouter();
  const { searchMode, setSearchMode } = useSidebarStore();
  const [query, setQuery] = useState("");
  const search = useSearch(searchMode ? query : "");

  useEffect(() => {
    if (!searchMode) setQuery("");
  }, [searchMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearchMode(false);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchMode(!useSidebarStore.getState().searchMode);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchMode]);

  const openHit = (hit: SearchHit) => {
    setSearchMode(false);
    router.push(hrefFor(hit));
  };

  const hits = search.data ?? [];
  const trimmed = query.trim();

  return (
    <AnimatePresence>
      {searchMode && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh] supports-backdrop-filter:backdrop-blur-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.01, ease: "easeOut" }}
          onClick={() => setSearchMode(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex max-h-[60vh] w-[600px] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, docs, projects…"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="flex-1 overflow-y-auto p-2 text-sm text-foreground">
              {!trimmed && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Search by meaning or keywords
                </p>
              )}
              {trimmed && search.isFetching && hits.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
              )}
              {trimmed && search.isError && (
                <p className="px-3 py-2 text-xs text-destructive">
                  {search.error instanceof Error
                    ? search.error.message
                    : "Search failed"}
                </p>
              )}
              {trimmed && !search.isFetching && !search.isError && hits.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
              )}
              {hits.map((hit) => (
                <button
                  key={`${hit.kind}:${hit.id}`}
                  type="button"
                  onClick={() => openHit(hit)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <KindBadge kind={hit.kind} />
                    <span className="min-w-0 truncate font-medium">
                      {hit.title || "Untitled"}
                    </span>
                  </span>
                  {hit.snippet ? (
                    <span className="line-clamp-2 pl-0 text-xs text-muted-foreground">
                      {hit.snippet}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function KindBadge({ kind }: { kind: SearchKind }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
      )}
    >
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useSearch } from "@/app/utils/hooks/search";
import type { SearchHit, SearchKind } from "@/app/utils/api/search";
import { cn } from "@/app/utils/cn";
import { openTasksEntity } from "@/app/utils/entityDetail";

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
  const { searchMode, setSearchMode } = useSidebarStore();

  const closeSearch = useCallback(() => setSearchMode(false), [setSearchMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSearch();

      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "k" || e.code === "KeyK")
      ) {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode(!useSidebarStore.getState().searchMode);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setSearchMode, closeSearch]);

  return (
    <AnimatePresence>
      {searchMode && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh] supports-backdrop-filter:backdrop-blur-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.01, ease: "easeOut" }}
          onClick={closeSearch}
        >
          {/* Query state lives in the panel so closing (unmounting) clears it
              without a setState-in-effect round trip. */}
          <SearchPanel onClose={closeSearch} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = useSearch(query);
  const hits = search.data ?? [];
  const trimmed = query.trim();

  const openHit = (hit: SearchHit) => {
    onClose();
    if (hit.kind === "task" || hit.kind === "project") {
      openTasksEntity(
        { kind: hit.kind, id: hit.id },
        { navigate: (href) => router.push(href, { scroll: false }) },
      );
      return;
    }
    router.push(hrefFor(hit));
  };

  return (
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
        aria-label="Search tasks, docs, projects"
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

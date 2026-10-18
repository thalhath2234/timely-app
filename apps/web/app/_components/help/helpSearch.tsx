"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, FileText, Hash, Search } from "lucide-react";
import { cn } from "@/app/utils/cn";
import type { SearchEntry } from "./registry";

function rank(entries: SearchEntry[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries
    .filter((entry) => words.every((word) => entry.terms.includes(word)))
    .map((entry) => {
      const title = entry.title.toLowerCase();
      let score = words.reduce((sum, word) => sum + (title.includes(word) ? 3 : 1), 0);
      if (title.startsWith(words[0])) score += 2;
      if (!entry.href.includes("#")) score += 1;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ entry }) => entry);
}

/** The help center's search box: filters articles and their headings as you type. */
export default function HelpSearch({
  entries,
  size = "large",
  className,
}: {
  entries: SearchEntry[];
  size?: "large" | "small";
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => rank(entries, query), [entries, query]);

  const go = (entry: SearchEntry) => {
    setOpen(false);
    setQuery("");
    router.push(entry.href);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-[12px] border border-[var(--s-line-strong)] bg-[var(--s-panel)] backdrop-blur transition-[border-color,box-shadow] focus-within:border-[var(--s-primary)] focus-within:shadow-[0_0_0_4px_rgba(192,193,255,0.1)]",
          size === "large" ? "h-14 px-5" : "h-10 rounded-[10px] px-3",
        )}
      >
        <Search className={cn("shrink-0 text-[var(--s-faint)]", size === "large" ? "size-5" : "size-4")} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (!results.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => (value + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => (value - 1 + results.length) % results.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(results[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={size === "large" ? "Search the help center" : "Search help"}
          aria-label="Search the help center"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          className={cn(
            "s-search-input h-full w-full min-w-0 bg-transparent text-[var(--s-ink)] outline-none placeholder:text-[var(--s-faint)] [&::-webkit-search-cancel-button]:hidden",
            size === "large" ? "text-base" : "text-sm",
          )}
        />
      </div>

      <AnimatePresence>
        {showList ? (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-0 top-full z-40 mt-2 max-h-[60vh] overflow-y-auto rounded-[12px] border border-[var(--s-line-strong)] bg-[var(--s-raised)] p-1.5 text-left shadow-2xl shadow-black/50"
          >
            {results.length ? (
              results.map((entry, index) => (
                <li
                  key={entry.href}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    go(entry);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5",
                    index === active ? "bg-white/[0.06]" : "",
                  )}
                >
                  {entry.href.includes("#") ? (
                    <Hash className="mt-0.5 size-4 shrink-0 text-[var(--s-faint)]" />
                  ) : (
                    <FileText className="mt-0.5 size-4 shrink-0 text-[var(--s-primary)]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--s-ink)]">{entry.title}</span>
                    <span className="block truncate text-xs text-[var(--s-faint)]">
                      {entry.section} · {entry.summary}
                    </span>
                  </span>
                  {index === active ? <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-[var(--s-faint)]" /> : null}
                </li>
              ))
            ) : (
              <li className="px-3 py-4 text-sm text-[var(--s-faint)]">No articles match &ldquo;{query}&rdquo;.</li>
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import type { SearchEntry } from "@/app/_components/help/registry";

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

const SUGGESTIONS = ["subscription", "auto-schedule", "pair phone", "backup", "mermaid"];

/** "Look it up": a search box written on a ruled line, with results set as index entries. */
export default function IndexSearch({ entries }: { entries: SearchEntry[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => rank(entries, query), [entries, query]);
  const showList = open && query.trim().length > 0;

  // "/" jumps to the search box unless you are typing somewhere else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (entry: SearchEntry) => {
    setOpen(false);
    router.push(entry.href);
  };

  return (
    <div className="d2-search relative">
      <label htmlFor={`${listId}-input`} className="d2-hand block -rotate-1 text-[1.6rem] leading-none text-[var(--verm-2)]">
        Look it up
      </label>
      <div className="mt-2 flex items-end gap-3 border-b-2 border-[var(--ink-2)] pb-1 transition-colors focus-within:border-[var(--verm)]">
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
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
            }
          }}
          placeholder="a word, a feature, a problem…"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          className="d2-serif h-14 w-full min-w-0 bg-transparent text-[1.6rem] text-[var(--ink)] outline-none sm:text-[2rem]"
          style={{ outline: "none" }}
        />
        <kbd className="d2-mono mb-3 hidden border border-b-2 border-[var(--rule-3)] px-1.5 text-xs text-[var(--ink-3)] sm:block">/</kbd>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-[var(--ink-3)]">
        <span className="mr-1">Try</span>
        {SUGGESTIONS.map((word, index) => (
          <span key={word} className="flex items-center">
            <button
              type="button"
              onClick={() => {
                setQuery(word);
                setActive(0);
                setOpen(true);
                inputRef.current?.focus();
              }}
              className="d2-serif min-h-10 px-1 text-base text-[var(--ink-2)] italic underline decoration-[var(--rule-3)] underline-offset-4 hover:text-[var(--ink)] hover:decoration-[var(--verm)]"
            >
              {word}
            </button>
            {index < SUGGESTIONS.length - 1 ? <span aria-hidden>,</span> : null}
          </span>
        ))}
      </p>

      <AnimatePresence>
        {showList ? (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            initial={{ opacity: 0, clipPath: "inset(0% 0% 100% 0%)" }}
            animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 top-[6.2rem] z-40 max-h-[60vh] overflow-y-auto border border-[var(--rule-3)] bg-[var(--sheet)] px-4 py-2 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)] sm:top-[6.8rem]"
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
                    "relative cursor-pointer border-b border-[var(--rule)] py-2.5 pl-4 last:border-b-0",
                    index === active && "bg-[var(--verm-wash)]",
                  )}
                >
                  {index === active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] bg-[var(--verm)]" /> : null}
                  <span className="flex items-baseline gap-2">
                    <span className="d2-serif truncate text-[1.1rem]">
                      {entry.href.includes("#") ? <span className="text-[var(--ink-3)]">§ </span> : null}
                      {entry.title}
                    </span>
                    <span aria-hidden className="d2-leader hidden sm:block" />
                    <span className="d2-mono hidden shrink-0 text-[10.5px] text-[var(--ink-3)] uppercase sm:inline">{entry.section}</span>
                  </span>
                  <span className="mt-0.5 block truncate pr-2 text-sm text-[var(--ink-3)]">{entry.summary}</span>
                </li>
              ))
            ) : (
              <li className="d2-serif py-4 text-[var(--ink-2)] italic">No entry for &ldquo;{query}&rdquo; in the index.</li>
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

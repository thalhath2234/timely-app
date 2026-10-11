"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
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

const HINTS = ["auto-schedule", "pair phone", "claude", "backup", "markdown", "working hours"];

/** Search over every article and heading, as a Swiss results table. Press / to focus. */
export default function HelpSearch({ entries }: { entries: SearchEntry[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => rank(entries, query), [entries, query]);
  const showList = open && query.trim().length > 0;

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
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="d4-label mb-2 block text-[var(--soft)]">
        Search every article and heading
      </label>
      <div className="d4-search">
        <Search aria-hidden className="size-5 shrink-0 text-[var(--soft)]" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          value={query}
          autoComplete="off"
          spellCheck={false}
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
          placeholder="Pairing, backups, Auto-schedule…"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        />
        <kbd className="hidden sm:inline-flex">/</kbd>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px] text-[var(--soft)]">
        <span className="mr-1">Try</span>
        {HINTS.map((hint) => (
          <button
            key={hint}
            type="button"
            onClick={() => {
              setQuery(hint);
              setActive(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
            className="d4-mono min-h-10 px-1.5 text-[12.5px] text-[var(--ink)] underline decoration-[var(--line-2)] underline-offset-4 hover:decoration-[var(--amber)]"
          >
            {hint}
          </button>
        ))}
      </p>

      <AnimatePresence>
        {showList ? (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.22, ease: [0.7, 0, 0.2, 1] }}
            className="absolute inset-x-0 top-[94px] z-40 max-h-[60vh] overflow-y-auto border border-[var(--line-2)] bg-[var(--bg)]"
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
                    "grid cursor-pointer grid-cols-[32px_minmax(0,1fr)] gap-x-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 sm:grid-cols-[32px_minmax(0,1fr)_minmax(0,0.6fr)]",
                    index === active ? "bg-[var(--ink)] text-[#0a0a0a]" : "",
                  )}
                >
                  <span className={cn("d4-mono pt-0.5 text-[11px]", index === active ? "text-[#0a0a0a]" : "text-[var(--faint)]")}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{entry.title}</span>
                    <span className={cn("block truncate text-[12.5px]", index === active ? "text-[#2a2a28]" : "text-[var(--soft)]")}>
                      {entry.href.includes("#") ? `In “${entry.summary}”` : entry.summary}
                    </span>
                  </span>
                  <span className={cn("d4-label hidden truncate pt-1 text-right text-[10.5px] sm:block", index === active ? "text-[#2a2a28]" : "text-[var(--faint)]")}>
                    {entry.section}
                  </span>
                </li>
              ))
            ) : (
              <li className="px-4 py-5 text-[15px] text-[var(--soft)]">No articles match &ldquo;{query}&rdquo;.</li>
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Hash, Search } from "lucide-react";
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

/** One calm search field over every article and heading in the help center. */
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
    <div className="srch">
      <label htmlFor={`${listId}-input`} className="sr">
        Search the help center
      </label>
      <div className="srch-box">
        <Search className="size-5 shrink-0 text-[var(--mint)]" aria-hidden />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          autoComplete="off"
          value={query}
          placeholder="Search the help center"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
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
        />
        <span className="kbd hidden sm:inline-flex" aria-hidden>
          /
        </span>
      </div>
      <AnimatePresence>
        {showList ? (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Matching articles"
            className="srch-list"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
                >
                  {entry.href.includes("#") ? (
                    <Hash className="mt-1 size-4 shrink-0 text-[var(--faint)]" aria-hidden />
                  ) : (
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-[var(--mint)]" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{entry.title}</span>
                    <span className="block truncate text-[14px] text-[var(--soft)]">
                      {entry.section} · {entry.summary}
                    </span>
                  </span>
                  {index === active ? (
                    <CornerDownLeft className="mt-1.5 size-4 shrink-0 text-[var(--faint)]" aria-hidden />
                  ) : null}
                </li>
              ))
            ) : (
              <li role="option" aria-selected={false} aria-disabled className="text-[15px] text-[var(--soft)]">
                Nothing matches “{query}”. Try fewer words.
              </li>
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

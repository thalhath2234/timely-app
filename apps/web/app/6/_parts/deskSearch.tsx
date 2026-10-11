"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import type { SearchEntry } from "@/app/_components/help/registry";
import { cn } from "@/app/utils/cn";

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
    .slice(0, 7)
    .map(({ entry }) => entry);
}

/** The help desk search: an index card you type on, results drop down below it. */
export default function DeskSearch({ entries }: { entries: SearchEntry[] }) {
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

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search the help center
      </label>
      <div className="d6-paper d6-search relative flex items-center gap-3 px-4 sm:px-5">
        <span aria-hidden className="absolute inset-x-0 bottom-2.5 h-px bg-[#e5484d]/40" />
        <Search className="size-6 shrink-0 text-[var(--paper-ink)]" strokeWidth={2.4} />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search: pair my phone, auto-schedule, MCP…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="d6-search-input d6-hand h-16 min-w-0 flex-1 bg-transparent text-[1.35rem] font-bold text-[var(--paper-ink)] outline-none placeholder:font-normal placeholder:text-[#6b6455] sm:text-[1.5rem]"
        />
        <kbd className="hidden h-7 items-center rounded-md border-[1.5px] border-b-[3px] border-[var(--paper-ink)] px-2 font-mono text-sm font-bold text-[var(--paper-ink)] sm:flex">
          /
        </kbd>
      </div>

      <AnimatePresence>
        {showList ? (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            initial={{ y: -6, rotate: -0.6 }}
            animate={{ y: 0, rotate: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute inset-x-0 top-[calc(100%+10px)] z-30 max-h-[420px] overflow-y-auto rounded-lg border border-[var(--line-2)] bg-[#262420] p-1.5 shadow-[0_24px_50px_-20px_rgb(0_0_0/0.9)]"
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
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 py-2",
                    index === active ? "bg-[var(--n-yellow)] text-[var(--paper-ink)]" : "text-[var(--ink)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{entry.title}</span>
                    <span className={cn("block truncate text-sm", index === active ? "text-[var(--paper-soft)]" : "text-[var(--soft)]")}>
                      {entry.section} · {entry.summary}
                    </span>
                  </span>
                  {index === active ? <CornerDownLeft className="size-4 shrink-0" /> : null}
                </li>
              ))
            ) : (
              <li className="px-3 py-3 text-[var(--soft)]">Nothing matches “{query}”. Try fewer words.</li>
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

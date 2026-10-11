"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, FileText, Hash, Search, Star } from "lucide-react";
import type { SearchEntry } from "@/app/_components/help/registry";
import { useReduced } from "./motion";

type Row = { href: string; title: string; summary: string; section: string; popular?: boolean };

function rank(entries: SearchEntry[], query: string): Row[] {
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

const EXAMPLES = ["pair my phone", "auto-schedule", "export markdown", "claude subscription", "working hours"];

/**
 * The help home's search: a command menu that is always open. Empty, it lists
 * popular articles; typing filters every article and heading. Arrow keys move,
 * Enter opens, "/" focuses it from anywhere on the page.
 */
export default function HelpPalette({ entries, popular }: { entries: SearchEntry[]; popular: Row[] }) {
  const router = useRouter();
  const reduced = useReduced();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [example, setExample] = useState({ word: 0, chars: EXAMPLES[0].length });
  const searching = query.trim().length > 0;
  const rows = useMemo(() => (searching ? rank(entries, query) : popular.map((row) => ({ ...row, popular: true }))), [entries, popular, query, searching]);

  // "/" focuses the box unless you are already typing somewhere.
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

  // While idle, the placeholder types example searches.
  const idle = !focused && !query && !reduced;
  useEffect(() => {
    if (!idle) return;
    const full = EXAMPLES[example.word];
    const done = example.chars >= full.length;
    const timer = window.setTimeout(
      () => setExample((value) => (done ? { word: (value.word + 1) % EXAMPLES.length, chars: 0 } : { ...value, chars: value.chars + 1 })),
      done ? 2200 : 70,
    );
    return () => window.clearTimeout(timer);
  }, [idle, example]);

  const placeholder = idle ? EXAMPLES[example.word].slice(0, example.chars) : "Search articles and headings";
  const open = (row: Row) => router.push(row.href);

  return (
    <div className="d3-hp">
      <div className="d3-hp-bar" data-focus={focused || undefined}>
        <Search aria-hidden className="d3-hp-ico" />
        <span className="d3-cmd-prompt" aria-hidden>
          ›
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, rows.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && rows[active]) {
              event.preventDefault();
              open(rows[active]);
            } else if (event.key === "Escape") {
              setQuery("");
              setActive(0);
            }
          }}
          placeholder={placeholder}
          aria-label="Search the help center"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="d3-key" data-size="sm" aria-hidden>
          /
        </kbd>
      </div>

      <div className="d3-hp-panel">
        <p className="d3-hp-head" aria-live="polite">
          <span>{searching ? `${rows.length} result${rows.length === 1 ? "" : "s"} for “${query.trim()}”` : "Popular"}</span>
          <span className="d3-hp-keys" aria-hidden>
            <kbd className="d3-key" data-size="sm">↑</kbd>
            <kbd className="d3-key" data-size="sm">↓</kbd> move
            <kbd className="d3-key" data-size="sm">↵</kbd> open
          </span>
        </p>
        <ul id={listId} role="listbox" aria-label={searching ? "Search results" : "Popular articles"} className="d3-hp-list">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.length ? (
              rows.map((row, index) => (
                <motion.li
                  key={`${row.href}-${searching ? "s" : "p"}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  layout="position"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, delay: searching ? 0 : index * 0.03 }}
                  className="d3-hp-row"
                  onMouseMove={() => setActive(index)}
                >
                  <Link href={row.href} tabIndex={-1}>
                    {row.popular ? (
                      <Star aria-hidden className="d3-ico-sm d3-hp-kind" />
                    ) : row.href.includes("#") ? (
                      <Hash aria-hidden className="d3-ico-sm d3-hp-kind" />
                    ) : (
                      <FileText aria-hidden className="d3-ico-sm d3-hp-kind" />
                    )}
                    <span className="d3-hp-title">{row.title}</span>
                    <span className="d3-hp-sum">{row.summary}</span>
                    <span className="d3-hp-sec">{row.section}</span>
                    <CornerDownLeft aria-hidden className="d3-ico-sm d3-hp-enter" />
                  </Link>
                </motion.li>
              ))
            ) : (
              <motion.li key="empty" className="d3-hp-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                No article matches &ldquo;{query}&rdquo;. Try fewer words, or ask on GitHub below.
              </motion.li>
            )}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

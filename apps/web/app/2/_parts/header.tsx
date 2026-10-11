"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";

const BASE = "/2";

const CHAPTERS = [
  { n: "1", label: "AI", href: `${BASE}#ai` },
  { n: "2", label: "How it works", href: `${BASE}#how-it-works` },
  { n: "3", label: "Docs & sheets", href: `${BASE}#docs-and-sheets` },
  { n: "6", label: "Download", href: `${BASE}#download` },
  { n: "¶", label: "Help", href: `${BASE}/help` },
];

/** Masthead: wordmark, chapter links, and the account buttons. */
export default function Header({ current }: { current?: "help" }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b-[3px] border-double border-[var(--rule-3)] bg-[var(--paper)]">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-8">
        <Link href={BASE} className="-ml-1 flex min-h-11 items-center gap-2 rounded-sm px-1" aria-label="Timely, design 2 home">
          <TimelyLogo size={24} className="text-[var(--ink)]" />
          <span className="d2-serif text-[1.6rem] leading-none font-medium tracking-[-0.02em]">Timely</span>
        </Link>
        {current === "help" ? (
          <span className="d2-kicker hidden border-l border-[var(--rule-2)] pl-3 sm:inline">Help · The index</span>
        ) : null}

        <nav aria-label="Chapters" className="d2-nav ml-auto hidden items-center lg:flex">
          {CHAPTERS.map((chapter) => (
            <Link
              key={chapter.href}
              href={chapter.href}
              aria-current={current === "help" && chapter.label === "Help" ? "page" : undefined}
              className="flex min-h-11 items-baseline gap-1.5 px-2.5 text-[0.9rem] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)] aria-[current=page]:text-[var(--ink)] xl:px-3"
            >
              <span className="d2-mono self-center text-[0.68rem] text-[var(--verm-2)]">{chapter.n}</span>
              <span className="self-center">{chapter.label}</span>
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-4">
          <a
            href={REPO_URL}
            className="hidden size-11 items-center justify-center rounded-sm text-[var(--ink-2)] transition-colors hover:text-[var(--ink)] sm:flex"
            aria-label="Timely on GitHub"
          >
            <GitHubMark className="size-[18px]" />
          </a>
          <Link href="/login" className="d2-btn d2-btn-text hidden sm:inline-flex">
            Log in
          </Link>
          <Link href="/signup" className="d2-btn d2-btn-verm !min-h-10 !px-3.5 sm:!px-4">
            Register
          </Link>
          <button
            type="button"
            className="d2-btn !min-h-10 !px-3 lg:!hidden"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden className="flex w-3.5 flex-col gap-[3px]">
              <span className={`h-px bg-current transition-transform ${open ? "translate-y-[4px] rotate-45" : ""}`} />
              <span className={`h-px bg-current transition-opacity ${open ? "opacity-0" : ""}`} />
              <span className={`h-px bg-current transition-transform ${open ? "-translate-y-[4px] -rotate-45" : ""}`} />
            </span>
            Contents
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            id={menuId}
            aria-label="Contents"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-[var(--rule)] bg-[var(--paper-2)] lg:hidden"
          >
            <div className="mx-auto max-w-[1240px] px-4 pt-3 pb-6 sm:px-8">
              <p className="d2-kicker pb-1">Contents</p>
              <ul>
                {CHAPTERS.map((chapter, index) => (
                  <li key={chapter.href}>
                    <Link
                      href={chapter.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-12 items-center gap-3 border-b border-[var(--rule)] text-lg"
                    >
                      <span className="d2-mono w-5 text-xs text-[var(--verm-2)]">{chapter.n}</span>
                      <span className="d2-serif">{chapter.label}</span>
                      <span aria-hidden className="d2-leader translate-y-1" />
                      <span aria-hidden className="d2-serif text-sm text-[var(--ink-3)] italic">
                        {["p. 4", "p. 11", "p. 17", "p. 29", "Index"][index]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/login" onClick={() => setOpen(false)} className="d2-btn">
                  Log in
                </Link>
                <a href={REPO_URL} className="d2-btn">
                  <GitHubMark className="size-4" />
                  GitHub
                </a>
              </div>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

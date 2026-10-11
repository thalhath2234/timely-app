"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { TimelyWordmark } from "@/app/_components/_ui/timelyLogo";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { cn } from "@/app/utils/cn";

const BASE = "/6";

const NAV = [
  { label: "AI", href: `${BASE}#ai` },
  { label: "How it works", href: `${BASE}#how-it-works` },
  { label: "Docs & sheets", href: `${BASE}#docs-and-sheets` },
  { label: "Download", href: `${BASE}#download` },
  { label: "Help", href: `${BASE}/help` },
];

export default function DeskHeader({ current }: { current?: "help" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[#191816]">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center gap-4 px-4 sm:px-6">
        <Link href={BASE} className="flex h-11 items-center rounded-lg pr-1" aria-label="Timely, design 6 home">
          <TimelyWordmark size={26} textClassName="d6-display text-[1.45rem] font-extrabold text-[var(--ink)]" />
        </Link>

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const on = current === "help" && item.label === "Help";
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group relative flex h-10 items-center rounded-lg px-3 text-[0.95rem] font-medium transition-colors",
                  on ? "text-[var(--ink)]" : "text-[var(--soft)] hover:text-[var(--ink)]",
                )}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 bottom-1.5 h-[3px] origin-left rounded-full bg-[var(--n-yellow)] transition-transform duration-300",
                    on ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={REPO_URL}
            className="hidden size-11 items-center justify-center rounded-lg text-[var(--soft)] transition-colors hover:bg-white/5 hover:text-[var(--ink)] sm:flex"
            aria-label="Timely on GitHub"
          >
            <GitHubMark className="size-5" />
          </a>
          <Link href="/login" className="d6-btn d6-btn-line hidden !min-h-10 sm:inline-flex">
            Log in
          </Link>
          <Link href="/signup" className="d6-btn d6-btn-note !min-h-10 !px-4">
            Register
          </Link>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-lg border border-[var(--line-2)] text-[var(--ink)] lg:hidden"
            aria-expanded={open}
            aria-controls="d6-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="d6-menu"
            key="menu"
            initial={{ y: -12, rotate: -1.5, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute inset-x-3 top-[calc(100%+8px)] origin-top lg:hidden"
          >
            <nav
              aria-label="Menu"
              className="d6-note p-2"
              style={{ ["--c" as string]: "var(--n-cream)" }}
            >
              <ul>
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="d6-display flex h-12 items-center rounded-md px-3 text-xl font-bold hover:bg-black/5"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2 border-t border-black/10 p-2 pt-3">
                <Link href="/login" onClick={() => setOpen(false)} className="d6-btn d6-btn-paper-line flex-1">
                  Log in
                </Link>
                <a href={REPO_URL} className="d6-btn d6-btn-ink flex-1">
                  <GitHubMark className="size-4" />
                  GitHub
                </a>
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { TimelyWordmark } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import { REPO_URL } from "./links";
import { GitHubMark } from "./marks";

const NAV = [
  { href: "/#ai", label: "AI" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#docs-and-sheets", label: "Docs and sheets" },
  { href: "/#download", label: "Download" },
  { href: "/help", label: "Help" },
] as const;

/**
 * `base` moves the landing and help links under a design variation (`/1`),
 * so the pair can be browsed as one site while the root stays unchanged.
 */
export default function SiteHeader({ base = "" }: { base?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the phone menu whenever the route changes.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color] duration-200",
        scrolled || open ? "s-header" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href={base || "/"} className="flex items-center rounded-lg" aria-label="Timely home">
          <TimelyWordmark size={26} textClassName="text-[1.35rem]" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = item.href === "/help" && pathname.startsWith(`${base}/help`);
            return (
              <Link
                key={item.href}
                href={`${base}${item.href}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  active ? "text-[var(--s-ink)]" : "s-link",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <a
            href={REPO_URL}
            aria-label="Timely on GitHub"
            className="s-link hidden size-9 items-center justify-center rounded-full sm:flex"
          >
            <GitHubMark className="size-[1.15rem]" />
          </a>
          <Link href="/login" className="s-link hidden rounded-full px-3 py-2 text-sm font-medium sm:block">
            Log in
          </Link>
          <Link href="/signup" className="s-btn-primary rounded-full px-4 py-2 text-sm font-semibold">
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="s-link flex size-9 items-center justify-center rounded-full md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            id="site-menu"
            aria-label="Main"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden md:hidden"
          >
            <div className="flex flex-col gap-1 px-4 pt-1 pb-5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={`${base}${item.href}`}
                  onClick={() => setOpen(false)}
                  className="s-link rounded-xl px-3 py-2.5 text-base font-medium hover:bg-white/5"
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/login" className="s-btn-ghost rounded-full px-4 py-2.5 text-center text-sm font-semibold">
                  Log in
                </Link>
                <a
                  href={REPO_URL}
                  className="s-btn-ghost inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold"
                >
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

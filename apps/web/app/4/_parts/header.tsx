"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { BASE, navFor } from "./data";

/** Black bar on the grid: wordmark, the five sections, sign-in. Phones get a full-height numbered menu. */
export default function Header() {
  const pathname = usePathname();
  const nav = navFor(BASE);
  const [open, setOpen] = useState(false);

  // Close the phone menu when the route changes.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflow;
    };
  }, [open]);

  return (
    <header className="d4-header">
      <div className="d4-wrap flex h-[var(--head)] items-center justify-between gap-4">
        <Link href={BASE} aria-label="Timely home" className="-ml-1 flex min-h-10 items-center gap-2 px-1">
          <TimelyLogo size={24} className="text-[var(--ink)] [&_.fill-primary]:fill-[var(--amber)]" />
          <span className="text-[1.3rem] font-bold tracking-[-0.045em]">Timely</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center lg:flex">
          {nav.map((item) => {
            const active = item.label === "Help" && pathname.startsWith(`${BASE}/help`);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="d4-navlink gap-1.5">
                <span className="d4-mono text-[10px] text-[var(--faint)]">{item.num}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <a href={REPO_URL} aria-label="Timely on GitHub" className="d4-navlink hidden !px-2.5 sm:inline-flex">
            <GitHubMark className="size-[18px]" />
          </a>
          <Link href="/login" className="d4-navlink hidden sm:inline-flex">
            Log in
          </Link>
          <Link href="/signup" className="d4-btn d4-btn-solid !min-h-10 !px-4 !text-sm">
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="d4-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="relative ml-1 flex size-11 items-center justify-center lg:hidden"
          >
            <span aria-hidden className="relative block h-3 w-6">
              <span
                className="absolute left-0 h-[2px] w-6 bg-[var(--ink)] transition-transform duration-200"
                style={{ top: 0, transform: open ? "translateY(5px) rotate(45deg)" : undefined }}
              />
              <span
                className="absolute left-0 h-[2px] w-6 bg-[var(--ink)] transition-transform duration-200"
                style={{ bottom: 0, transform: open ? "translateY(-5px) rotate(-45deg)" : undefined }}
              />
            </span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            id="d4-menu"
            aria-label="Main"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.35, ease: [0.7, 0, 0.2, 1] }}
            className="fixed inset-x-0 top-[var(--head)] bottom-0 z-50 overflow-y-auto bg-[var(--bg)] lg:hidden"
          >
            <ul className="d4-wrap pt-2">
              {nav.map((item) => (
                <li key={item.href} className="border-b border-[var(--line)]">
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-16 items-baseline gap-4 py-3 text-[2.4rem] leading-none font-bold tracking-[-0.05em]"
                  >
                    <span className="d4-mono w-7 text-xs font-normal tracking-normal text-[var(--faint)]">
                      {item.num}
                    </span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="d4-wrap flex flex-wrap gap-2 py-6">
              <Link href="/signup" className="d4-btn d4-btn-solid flex-1">
                Register
              </Link>
              <Link href="/login" className="d4-btn flex-1">
                Log in
              </Link>
              <a href={REPO_URL} className="d4-btn w-full">
                <GitHubMark className="size-4" />
                GitHub
              </a>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { TimelyWordmark } from "@/app/_components/_ui/timelyLogo";
import { cn } from "@/app/utils/cn";
import { REPO_URL } from "./links";
import { GitHubMark } from "./marks";

const NAV = [
  { href: "/#chapters", label: "Features" },
  { href: "/#self-host", label: "Self-host" },
  { href: "/#agents", label: "Agents" },
  { href: "/#download", label: "Download" },
  { href: "/help", label: "Help" },
] as const;

export default function SiteHeader() {
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
    <header className={cn("sticky top-0 z-50 transition-[background-color,border-color] duration-200", scrolled || open ? "s-header" : "border-b border-transparent")}>
      <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center rounded-lg" aria-label="Timely home">
          <TimelyWordmark size={26} textClassName="text-[1.35rem]" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => {
            const active = item.href === "/help" && pathname.startsWith("/help");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("rounded-[10px] px-3 py-2 text-sm font-medium transition-colors", active ? "bg-white/[0.06] text-[var(--s-ink)]" : "s-link")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <a href={REPO_URL} aria-label="Timely on GitHub" className="s-link hidden size-10 items-center justify-center rounded-[10px] sm:flex">
            <GitHubMark className="size-[1.15rem]" />
          </a>
          <Link href="/login" className="s-link hidden rounded-[10px] px-3 py-2 text-sm font-medium sm:block">
            Log in
          </Link>
          <Link href="/signup" className="s-btn s-btn-primary h-9 px-3.5 text-sm">
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="s-link flex size-10 items-center justify-center rounded-[10px] md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <nav id="site-menu" aria-label="Main" className="md:hidden">
          <div className="flex flex-col gap-1 px-4 pt-1 pb-5">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="s-link rounded-[10px] px-3 py-3 text-base font-medium hover:bg-white/5">
                {item.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href="/login" className="s-btn s-btn-ghost h-11">
                Log in
              </Link>
              <a href={REPO_URL} className="s-btn s-btn-ghost h-11">
                <GitHubMark className="size-4" />
                GitHub
              </a>
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

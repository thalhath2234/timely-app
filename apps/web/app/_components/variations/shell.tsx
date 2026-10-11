"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import TimelyLogo from "@/app/_components/_ui/timelyLogo";
import { ISSUES_URL, LATEST_RELEASE_URL, LICENSE_URL, REPO_URL } from "@/app/_components/site/links";
import { GitHubMark } from "@/app/_components/site/marks";
import { SiteMotion } from "@/app/_components/site/motion";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";
import "./variations.css";

export type NavItem = { href: string; label: string };

/**
 * The frame every design variation shares: the always-dark `.site` canvas,
 * the public-site motion rules, a header, a footer and the design switcher.
 * Each variation themes it through the `--v-*` tokens in its own stylesheet
 * (see variations.css) and lays out everything inside on its own.
 */
export function VariantShell({
  n,
  nav,
  className,
  style,
  children,
}: {
  /** Which design this is, 2 to 5; links and the switcher are built from it. */
  n: number;
  /** In-page anchors for the landing page, written without the base (`#ai`). */
  nav: NavItem[];
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const base = `/${n}`;
  return (
    <div className={cn("site v", className)} style={style}>
      <SiteMotion>
        <VariantHeader base={base} nav={nav} />
        <main id="main-content">{children}</main>
        <VariantFooter base={base} />
        <DesignSwitcher />
      </SiteMotion>
    </div>
  );
}

function VariantHeader({ base, nav }: { base: string; nav: NavItem[] }) {
  const pathname = usePathname();
  const onHelp = pathname.startsWith(`${base}/help`);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  const items: NavItem[] = [
    ...nav.map((item) => ({ ...item, href: `${base}/${item.href}` })),
    { href: `${base}/help`, label: "Help" },
  ];

  return (
    <header className={cn("v-header sticky top-0 z-50", (scrolled || open) && "is-scrolled")}>
      <div className="v-container flex h-16 items-center justify-between gap-4">
        <Link href={base} className="v-brand flex items-center gap-2.5 rounded-lg" aria-label="Timely home">
          <TimelyLogo size={26} />
          <span className="text-[1.35rem] font-semibold tracking-[-0.03em]">Timely</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const active = item.label === "Help" && onHelp;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("v-nav-link", active && "is-active")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <a href={REPO_URL} aria-label="Timely on GitHub" className="v-nav-link hidden size-9 items-center justify-center !px-0 sm:flex">
            <GitHubMark className="size-[1.15rem]" />
          </a>
          <Link href="/login" className="v-nav-link hidden sm:block">
            Log in
          </Link>
          <Link href="/signup" className="v-btn v-btn-primary !h-9 !px-4 !text-sm">
            Register
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="v-nav-link flex size-9 items-center justify-center !px-0 md:hidden"
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
            <div className="v-container flex flex-col gap-1 pt-1 pb-5">
              {items.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="v-nav-link !px-3 !py-2.5 !text-base">
                  {item.label}
                </Link>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/login" className="v-btn v-btn-ghost justify-center">
                  Log in
                </Link>
                <a href={REPO_URL} className="v-btn v-btn-ghost justify-center">
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

function VariantFooter({ base }: { base: string }) {
  const columns = [
    {
      title: "Product",
      links: [
        { href: `${base}/#ai`, label: "AI and agents" },
        { href: `${base}/#how-it-works`, label: "How it works" },
        { href: `${base}/#features`, label: "Features" },
        { href: `${base}/#download`, label: "Download" },
      ],
    },
    {
      title: "Help",
      links: [
        { href: `${base}/help`, label: "Help center" },
        { href: "/help/install/windows", label: "Install on Windows" },
        { href: "/help/install/ubuntu", label: "Install on Ubuntu" },
        { href: "/help/install/arch", label: "Install on Arch" },
        { href: "/help/install/android", label: "Install on Android" },
      ],
    },
    {
      title: "Project",
      links: [
        { href: REPO_URL, label: "Source code" },
        { href: LATEST_RELEASE_URL, label: "Latest release" },
        { href: ISSUES_URL, label: "Report an issue" },
        { href: LICENSE_URL, label: "MIT licence" },
      ],
    },
  ];
  return (
    <footer className="v-footer">
      <div className="v-container grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <TimelyLogo size={24} />
            <span className="text-lg font-semibold tracking-[-0.03em]">Timely</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--v-soft)]">
            A private planner that turns loose thoughts into a planned week. Open source, and it runs on your own
            computer.
          </p>
          <a href={REPO_URL} className="v-link mt-5 inline-flex items-center gap-2 text-sm font-medium">
            <GitHubMark className="size-4" />
            thalhath2234/timely-app
          </a>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-semibold">{column.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("http") ? (
                    <a href={link.href} className="v-link">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="v-link">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="v-container pb-10 text-xs text-[var(--v-faint)]">
        An open-source personal project. Windows, Linux and Android.
      </div>
    </footer>
  );
}

const DESIGNS = [1, 2, 3, 4, 5] as const;

/**
 * A small pill for comparing the designs: it hops between /N and /N/help,
 * keeping whichever of the two pages is open. Shown only on numbered pages.
 */
export function DesignSwitcher() {
  const pathname = usePathname();
  const match = pathname.match(/^\/([1-5])(\/help)?/);
  if (!match) return null;
  const current = Number(match[1]);
  const suffix = match[2] ?? "";
  return (
    <nav aria-label="Design variations" className="v-switcher">
      <span className="v-switcher-label">Design</span>
      {DESIGNS.map((n) => (
        <Link
          key={n}
          href={`/${n}${suffix}`}
          aria-current={n === current ? "page" : undefined}
          className={cn("v-switcher-item", n === current && "is-current")}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/app/utils/cn";

export type SidebarSection = {
  id: string;
  title: string;
  articles: { href: string; title: string }[];
};

function SectionList({ sections, pathname, onNavigate }: { sections: SidebarSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.id}>
          <p className="px-3 text-xs font-semibold tracking-wide text-[var(--s-faint)] uppercase">{section.title}</p>
          <ul className="mt-2 space-y-px">
            {section.articles.map((article) => {
              const active = pathname === article.href;
              return (
                <li key={article.href} className="relative">
                  {active ? (
                    <motion.span
                      layoutId="help-sidebar-active"
                      className="absolute inset-0 rounded-lg bg-[var(--s-primary)]/10"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  <Link
                    href={article.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative block rounded-lg px-3 py-1.5 text-sm transition-colors",
                      active ? "font-medium text-[var(--s-primary)]" : "text-[var(--s-soft)] hover:text-[var(--s-ink)]",
                    )}
                  >
                    {article.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Every article, grouped by section. A drawer on narrow screens, a sticky column on wide ones. */
export default function HelpSidebar({ sections }: { sections: SidebarSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = sections.flatMap((section) => section.articles).find((article) => article.href === pathname);

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="help-nav"
          className="s-card flex w-full items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-left text-sm"
        >
          <span className="min-w-0">
            <span className="s-faint block text-xs">All articles</span>
            <span className="block truncate font-medium">{current?.title ?? "Browse the help center"}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.nav
              id="help-nav"
              aria-label="Help articles"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="s-card mt-2 rounded-[10px] p-3">
                <SectionList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
              </div>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </div>

      <nav aria-label="Help articles" className="hidden lg:block">
        <SectionList sections={sections} pathname={pathname} />
      </nav>
    </>
  );
}

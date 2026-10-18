"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";

/** "On this page": the article's headings, with the one you are reading highlighted. */
export default function OnThisPage({ headings }: { headings: { id: string; title: string }[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    const update = () => {
      // The last heading whose top has passed a line a little below the header.
      let current = headings[0]?.id ?? "";
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= 140) current = heading.id;
      }
      // At the very bottom, the last heading may never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = headings[headings.length - 1]?.id ?? current;
      }
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page">
      <p className="text-xs font-semibold tracking-wide text-[var(--s-faint)] uppercase">On this page</p>
      <ul className="relative mt-3 border-l border-white/[0.08]">
        {headings.map((heading) => {
          const isActive = heading.id === active;
          return (
            <li key={heading.id} className="relative">
              {isActive ? (
                <motion.span
                  layoutId="help-toc-active"
                  className="absolute top-0 bottom-0 -left-px w-px bg-[var(--s-primary)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              ) : null}
              <a
                href={`#${heading.id}`}
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "block py-1.5 pl-4 text-sm leading-snug transition-colors",
                  isActive ? "text-[var(--s-ink)]" : "text-[var(--s-faint)] hover:text-[var(--s-soft)]",
                )}
              >
                {heading.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

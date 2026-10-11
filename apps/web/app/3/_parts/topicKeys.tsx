"use client";

import { useEffect } from "react";

/** Number keys 1–9 jump to a help topic (and focus its first article) when you are not typing. */
export default function TopicKeys({ ids }: { ids: string[] }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= ids.length) return;
      const section = document.getElementById(`topic-${ids[index]}`);
      if (!section) return;
      event.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      section.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
      section.setAttribute("data-flash", "");
      window.setTimeout(() => section.removeAttribute("data-flash"), 900);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids]);
  return null;
}

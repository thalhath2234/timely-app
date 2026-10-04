"use client";

import { useEffect, useState } from "react";
import { cn } from "@/app/utils/cn";
import { hueStyle } from "./hue";
import { LOOP_STEPS } from "./loopSteps";

/** A slim strip in the header that shows which step of the loop is on screen. Desktop widths only. */
export default function LoopNav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScreen = new Set<string>();
    // A section counts as current while it crosses a thin band at mid-viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target.id);
          else onScreen.delete(entry.target.id);
        }
        setActive(LOOP_STEPS.find((step) => onScreen.has(step.id))?.id ?? null);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const step of LOOP_STEPS) {
      const section = document.getElementById(step.id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Steps of the loop"
      className={cn(
        "l-card mx-auto hidden items-center gap-1 rounded-full p-1 transition-opacity duration-200 lg:flex",
        active ? "opacity-100" : "invisible opacity-0",
      )}
    >
      {LOOP_STEPS.map((step, index) => {
        const current = step.id === active;
        return (
          <a
            key={step.id}
            href={`#${step.id}`}
            aria-current={current ? "step" : undefined}
            style={hueStyle(step.hue)}
            className={cn(
              "l-hue flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200",
              current ? "l-label" : "l-soft hover:text-[var(--l-ink)]",
            )}
          >
            <span className="font-mono tabular-nums opacity-70">{index + 1}</span>
            {step.label}
          </a>
        );
      })}
    </nav>
  );
}

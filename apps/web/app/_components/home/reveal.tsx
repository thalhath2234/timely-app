"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/** Fades a block in the first time it scrolls into view (CSS in site.css, `.s-reveal`). */
export function Reveal({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.dataset.in = "";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // @ts-expect-error the ref type depends on the tag
  return <Tag ref={ref} className={cn("s-reveal", className)}>{children}</Tag>;
}

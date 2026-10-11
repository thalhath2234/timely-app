"use client";

import { useEffect, useInsertionEffect, useRef, type ReactNode } from "react";
import { usePublicSite } from "@/app/_components/site/motion";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { useReduced } from "./hooks";
import { fontVars } from "./fonts";
import "./design.css";

/**
 * The page root: forced-dark paper, the fonts, Motion's reduced-motion mode,
 * and the scroll reveals. Reveals only hide content once this script runs and
 * motion is allowed, so the page reads complete without JavaScript.
 */
export default function Shell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReduced();

  useInsertionEffect(() => {
    MotionGlobalConfig.skipAnimations = reduced;
    return () => {
      MotionGlobalConfig.skipAnimations = false;
    };
  }, [reduced]);

  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || typeof IntersectionObserver === "undefined") return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".d2-rv, .d2-rv-leader"));
    const fold = window.innerHeight * 0.92;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-in", "");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (rect.top < fold && rect.bottom > 0) item.setAttribute("data-in", "");
      else observer.observe(item);
    }
    root.setAttribute("data-reveal", "");
    return () => {
      observer.disconnect();
      root.removeAttribute("data-reveal");
    };
  }, [reduced]);

  usePublicSite();

  return (
    <div ref={ref} className={`d2 ${fontVars}`}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </div>
  );
}

"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import { useReduced } from "./hooks";
import { Ring } from "./ink";

/** A pen circle that draws itself around a heading once it scrolls into view. */
export function RingInView({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const reduced = useReduced();
  return (
    <span ref={ref} aria-hidden className="pointer-events-none absolute inset-0">
      <Ring on={inView || reduced} delay={0.3} className={className} />
    </span>
  );
}

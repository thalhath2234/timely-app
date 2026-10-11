"use client";

import { motion } from "motion/react";
import { useReduced } from "./kinetic";

/**
 * The headline sets itself: each line swells from hairline to heavy weight
 * and slides onto its column. Opacity never changes, so it reads at once.
 */
export default function HeroTitle({ lines, className }: { lines: string[]; className?: string }) {
  const reduced = useReduced();
  return (
    <h1 className={className}>
      {lines.map((line, index) => (
        <motion.span
          key={line}
          className="block"
          initial={reduced ? false : { fontWeight: 150, x: index % 2 ? 48 : -24 }}
          animate={{ fontWeight: 820, x: 0 }}
          transition={{ duration: 1.1, delay: 0.1 + index * 0.18, ease: [0.7, 0, 0.2, 1] }}
        >
          {line}
        </motion.span>
      ))}
    </h1>
  );
}

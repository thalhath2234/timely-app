"use client";

import { motion } from "motion/react";

/** A ring cut into one arc per topic, drawn in one after another, breathing slowly once it is whole. */
export function TopicRing({ sections, articles }: { sections: { id: string; count: number }[]; articles: number }) {
  const gap = 0.022;
  const r = 86;
  const point = (turn: number) => {
    const a = turn * Math.PI * 2;
    return `${(100 + Math.sin(a) * r).toFixed(2)} ${(100 - Math.cos(a) * r).toFixed(2)}`;
  };
  const starts = sections.map((_, i) => sections.slice(0, i).reduce((sum, item) => sum + item.count / articles, 0));
  return (
    <div className="relative mx-auto size-[200px] sm:size-[240px] lg:size-[300px]" aria-hidden>
      <svg viewBox="0 0 200 200" className="size-full overflow-visible">
        <circle
          className="breathe"
          cx="100"
          cy="100"
          r="97"
          fill="none"
          stroke="rgb(168 224 195 / 14%)"
          strokeWidth="1"
        />
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgb(190 225 205 / 7%)" strokeWidth="5" />
        {sections.map((section, i) => {
          const share = section.count / articles;
          const from = starts[i] + gap / 2;
          const to = starts[i] + share - gap / 2;
          return (
            <motion.path
              key={section.id}
              d={`M ${point(from)} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${point(to)}`}
              fill="none"
              stroke={i % 2 ? "var(--sage)" : "var(--mint)"}
              strokeWidth="5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 0.7,
                delay: 0.3 + i * 0.18,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num text-[52px] leading-none font-extralight tracking-[-0.03em] lg:text-[64px]">
          {articles}
        </span>
        <span className="mt-1 text-[14px] text-[var(--soft)]">articles in {sections.length} topics</span>
      </div>
    </div>
  );
}

/** A hairline that draws itself across when it scrolls into view. */
export function DrawLine() {
  return (
    <motion.span
      aria-hidden
      className="absolute top-[-1px] left-0 block h-px w-full origin-left bg-[var(--sage)]"
      initial={{ scaleX: 0, opacity: 1 }}
      whileInView={{ scaleX: 1, opacity: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{
        scaleX: { duration: 1.2, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 1.2, delay: 1.2 },
      }}
    />
  );
}

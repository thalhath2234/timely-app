"use client";

import { motion, type MotionValue } from "motion/react";

/** Rounded so the server and the browser print the same coordinates. */
const fx = (n: number) => Math.round(n * 100) / 100;

/** A thin progress ring. `progress` is 0..1, as a number or a motion value. */
export function Ring({
  progress,
  size = 100,
  stroke = 3,
  color = "var(--mint)",
  track = "var(--line-2)",
  ticks = 0,
  className,
}: {
  progress: number | MotionValue<number>;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  ticks?: number;
  className?: string;
}) {
  const r = 50 - stroke / 2 - (ticks ? 6 : 0);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      {ticks
        ? Array.from({ length: ticks }, (_, i) => {
            const a = (i / ticks) * Math.PI * 2;
            const long = i % (ticks / 12) === 0;
            const r1 = 49.5;
            const r2 = long ? 46 : 47.6;
            return (
              <line
                key={i}
                x1={fx(50 + Math.sin(a) * r1)}
                y1={fx(50 - Math.cos(a) * r1)}
                x2={fx(50 + Math.sin(a) * r2)}
                y2={fx(50 - Math.cos(a) * r2)}
                stroke={long ? "var(--line-3)" : "var(--line-2)"}
                strokeWidth={long ? 0.7 : 0.45}
              />
            );
          })
        : null}
      <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <motion.circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ pathLength: progress }}
      />
    </svg>
  );
}

/** "25:00" style text for a number of seconds. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

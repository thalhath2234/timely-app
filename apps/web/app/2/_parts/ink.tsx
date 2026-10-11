"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { useReduced } from "./hooks";

const pen = [0.45, 0.05, 0.4, 1] as const;

/**
 * A handwritten line that draws on: a clip sweeps left to right like a pen,
 * each glyph's outline strokes in, then the ink fills. With reduced motion
 * (or `on` true from the first render) it is simply there.
 */
export function Hand({
  text,
  on,
  duration = 1,
  delay = 0,
  size = 24,
  width,
  className,
}: {
  text: string;
  on: boolean;
  duration?: number;
  delay?: number;
  size?: number;
  width?: number;
  className?: string;
}) {
  const id = `d2h${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reduced = useReduced();
  const shown = on || reduced;
  const w = width ?? Math.ceil(text.length * size * 0.4) + 10;
  const h = Math.round(size * 1.3);
  const fast = reduced || !on;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("block h-auto max-w-full overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <clipPath id={id}>
          <motion.rect
            x={-6}
            y={-h}
            height={h * 3}
            initial={false}
            animate={{ width: shown ? w + 12 : 0 }}
            transition={{ duration: fast ? 0 : duration, delay: fast ? 0 : delay, ease: pen }}
          />
        </clipPath>
      </defs>
      <motion.text
        x={2}
        y={Math.round(size * 0.98)}
        clipPath={`url(#${id})`}
        fontSize={size}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={0.6}
        strokeDasharray={60}
        initial={false}
        animate={{ fillOpacity: shown ? 1 : 0.2, strokeDashoffset: shown ? 0 : 60 }}
        transition={{ duration: fast ? 0 : duration * 0.9, delay: fast ? 0 : delay + duration * 0.25 }}
        style={{ fontFamily: "var(--hand)" }}
      >
        {text}
      </motion.text>
    </svg>
  );
}

/** A vermilion pen stroke through a line, drawn left to right. */
export function Strike({
  on,
  delay = 0,
  className,
  style,
}: {
  on: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute overflow-visible", className)}
      style={style}
      aria-hidden
    >
      <motion.path
        d="M1 6 C 22 3.5, 45 7.5, 68 4.8 S 92 5.5, 99 4"
        fill="none"
        stroke="var(--verm)"
        strokeWidth={2.2}
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ pathLength: { duration: 0.45, delay, ease: pen }, opacity: { duration: 0.1, delay } }}
      />
    </svg>
  );
}

/** A hand-drawn tick. */
export function Tick({ on, className, delay = 0 }: { on: boolean; className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 24 20" className={cn("overflow-visible", className)} aria-hidden>
      <motion.path
        d="M2.5 11.5 C 5 13, 7 15.5, 8.6 17.6 C 12 10.5, 16.5 5.5, 22 1.8"
        fill="none"
        stroke="var(--verm)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ pathLength: { duration: 0.4, delay, ease: pen }, opacity: { duration: 0.05, delay } }}
      />
    </svg>
  );
}

/** A loose pen circle around something, for margin annotations. */
export function Ring({ on, className, delay = 0 }: { on: boolean; className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 120 50" preserveAspectRatio="none" className={cn("pointer-events-none absolute overflow-visible", className)} aria-hidden>
      <motion.path
        d="M70 4 C 30 1, 3 10, 4 26 C 5 42, 42 48, 74 46 C 104 44, 118 34, 116 22 C 114 9, 92 3, 58 6"
        fill="none"
        stroke="var(--verm)"
        strokeWidth={1.8}
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ pathLength: { duration: 0.7, delay, ease: pen }, opacity: { duration: 0.05, delay } }}
      />
    </svg>
  );
}

/** A rubber stamp that lands with a thump. */
export function Stamp({
  on,
  children,
  className,
  angle = -8,
}: {
  on: boolean;
  children: ReactNode;
  className?: string;
  angle?: number;
}) {
  return (
    <motion.div
      aria-hidden
      initial={false}
      animate={on ? { opacity: 0.94, scale: 1, rotate: angle } : { opacity: 0, scale: 1.9, rotate: angle - 7 }}
      transition={on ? { type: "spring", stiffness: 520, damping: 26, mass: 0.9 } : { duration: 0.2 }}
      className={cn("d2-stamp pointer-events-none absolute", className)}
    >
      {children}
    </motion.div>
  );
}

"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { motion as MOTION } from "@timely/contract/designTokens";
import { cn } from "@/app/utils/cn";
import { easeOut, motionSeconds } from "@/app/_components/_ui/motion";

/*
 * Motion for data that changes (catalogue items 3, 4 and 12): a number
 * pops and counts up, the card it sits in tints for a second, a bar fills
 * from where it was. Nothing here moves on first paint beyond the bar.
 */

/** 20 frames: how long a number counts or a bar fills. */
const COUNT_SECONDS = 20 / MOTION.fps;
/** Numbers above this count up instead of jumping. */
const COUNT_FROM = 10;

/** 0 on mount, then one higher every time `value` changes. Key an element on it to replay its entrance. */
export function useChangeKey(value: unknown) {
  const [key, setKey] = useState(0);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setKey((current) => current + 1);
  }, [value]);
  return key;
}

function numeric(value: ReactNode): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d{1,9}$/.test(value.trim())) return Number(value);
  return null;
}

/**
 * A stat's number. When it changes it pops (10 frames, 0.94 to 1) and, when
 * both values are numbers above 10, counts from the old value to the new one
 * over 20 frames. Any other value pops only.
 */
export function StatNumber({
  value,
  className,
  as: Tag = "span",
  title,
}: {
  value: ReactNode;
  className?: string;
  as?: "span" | "p";
  title?: string;
}) {
  const changeKey = useChangeKey(value);
  const reduce = useReducedMotion();
  const target = numeric(value);
  const [shown, setShown] = useState<number | null>(target);
  const lastTarget = useRef(target);

  useEffect(() => {
    const from = lastTarget.current;
    lastTarget.current = target;
    if (target === null || from === null || from === target) {
      setShown(target);
      return;
    }
    if (reduce || Math.max(Math.abs(from), Math.abs(target)) <= COUNT_FROM) {
      setShown(target);
      return;
    }
    const controls = animate(from, target, {
      duration: COUNT_SECONDS,
      ease: easeOut,
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    return () => controls.stop();
  }, [target, reduce]);

  const text = target !== null && shown !== null ? shown.toLocaleString() : value;
  const props = {
    key: changeKey,
    className: cn("inline-block tabular-nums", className),
    initial: changeKey > 0 ? { scale: 0.94 } : false,
    animate: { scale: 1 },
    transition: { duration: motionSeconds.pop, ease: easeOut },
    style: { transformOrigin: "left center" } as const,
    title,
  };
  return Tag === "p" ? <motion.p {...props}>{text}</motion.p> : <motion.span {...props}>{text}</motion.span>;
}

/**
 * The tint a card shows for a second after its value changed. Render it as
 * the first child of a `relative` card; it covers the card and fades out.
 */
export function ChangeTint({ changeKey, className }: { changeKey: number; className?: string }) {
  if (!changeKey) return null;
  return (
    <motion.span
      key={changeKey}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-0 rounded-[inherit] bg-primary", className)}
      initial={{ opacity: 0.14 }}
      animate={{ opacity: 0 }}
      transition={{ duration: motionSeconds.highlight, ease: easeOut }}
    />
  );
}

/**
 * A bar whose fill animates from its previous share to the new one over
 * 20 frames. `value` is 0 to 1; `height` in px (1, 1.5 or 3 in the kit).
 */
export function Fill({
  value,
  color,
  height = 4,
  className,
  trackClassName,
  style,
}: {
  value: number;
  color?: string | null;
  height?: number;
  className?: string;
  trackClassName?: string;
  style?: CSSProperties;
}) {
  const share = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <span
      aria-hidden
      className={cn("block w-full overflow-hidden rounded-full bg-muted", trackClassName)}
      style={{ height, ...style }}
    >
      <motion.span
        className={cn("block h-full rounded-full", className)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(share * 1000) / 10}%` }}
        transition={{ duration: COUNT_SECONDS, ease: easeOut }}
        style={{ backgroundColor: color || "var(--primary)" }}
      />
    </span>
  );
}

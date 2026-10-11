"use client";

import {
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePublicSite } from "@/app/_components/site/motion";
import { MotionConfig, MotionGlobalConfig, motion, useInView, useScroll, useTransform } from "motion/react";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(listener: () => void) {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** True when the visitor asked for less motion. False on the server and while hydrating, so the markup matches. */
export function useReduced() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/**
 * Wraps a design-4 page. With reduced motion every Motion animation jumps to
 * its end state; scroll-linked styles check `useReduced` themselves.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  usePublicSite();
  const reduced = useReduced();
  useInsertionEffect(() => {
    MotionGlobalConfig.skipAnimations = reduced;
    return () => {
      MotionGlobalConfig.skipAnimations = false;
    };
  }, [reduced]);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Steps a looping graphic through frames while it is on screen. `ms` is one
 * delay per frame. With reduced motion it rests on `rest` (the last frame).
 */
export function useSteps(ms: readonly number[], rest = ms.length - 1) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.25 });
  const reduced = useReduced();
  const [tick, setTick] = useState(0);
  const frame = tick % ms.length;

  useEffect(() => {
    if (!inView || reduced) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), ms[frame]);
    return () => window.clearTimeout(timer);
  }, [inView, reduced, frame, ms]);

  return { ref, frame: reduced ? rest : frame, cycle: reduced ? 0 : Math.floor(tick / ms.length), playing: inView && !reduced };
}

/**
 * A heading whose weight follows the scroll: light as it enters the bottom of
 * the screen, heavy by the time it reaches the upper third. Always readable;
 * with reduced motion it simply sits at its heavy weight.
 */
export function KineticHeading({
  as: Tag = "h2",
  children,
  className,
  from = 260,
  to = 780,
  id,
}: {
  as?: "h1" | "h2" | "h3";
  children: ReactNode;
  className?: string;
  from?: number;
  to?: number;
  id?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduced = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.35"] });
  const weight = useTransform(scrollYProgress, [0, 1], [from, to]);
  const tracking = useTransform(scrollYProgress, [0, 1], ["-0.02em", "-0.052em"]);
  const MotionTag = motion[Tag];
  return (
    <MotionTag
      ref={ref}
      id={id}
      className={className}
      style={reduced ? { fontWeight: to, letterSpacing: "-0.052em" } : { fontWeight: weight, letterSpacing: tracking }}
    >
      {children}
    </MotionTag>
  );
}

/** A big section numeral that slides along its row as the section scrolls past. */
export function SlidingNumeral({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.3"] });
  const x = useTransform(scrollYProgress, [0, 1], ["-10%", "0%"]);
  const weight = useTransform(scrollYProgress, [0.15, 0.9], [200, 850]);
  return (
    <div ref={ref} className={className} aria-hidden>
      <motion.span className="block" style={reduced ? { fontWeight: 850 } : { x, fontWeight: weight }}>
        {children}
      </motion.span>
    </div>
  );
}

/**
 * Slides content a short way up as it enters. Opacity never changes, so the
 * text is readable even if the animation never runs.
 */
export function Rise({
  children,
  className,
  delay = 0,
  distance = 28,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ y: distance }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** A flat colour bar that wipes across from the left when it scrolls into view. */
export function Wipe({
  color,
  className,
  delay = 0,
  axis = "x",
  style,
}: {
  color: string;
  className?: string;
  delay?: number;
  axis?: "x" | "y";
  style?: CSSProperties;
}) {
  const scale = axis === "x" ? "scaleX" : "scaleY";
  return (
    <motion.div
      aria-hidden
      className={className}
      style={{ ...style, background: color, originX: 0, originY: 1 }}
      initial={{ [scale]: 0 }}
      whileInView={{ [scale]: 1 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.8, delay, ease: [0.7, 0, 0.2, 1] }}
    />
  );
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig, motion, useInView } from "motion/react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** The visitor's OS setting. False on the server so graphics hydrate in their first frame. */
export function useReduced() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * The app wraps everything in MotionConfig "always" until a signed-in user
 * turns motion on; the public page follows the visitor's OS setting instead.
 */
export function D3Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Steps through `count` frames, `ms` apart (one number or one delay per frame),
 * only while the element is on screen. It opens on `rest` (the finished frame)
 * and with reduced motion it stays there.
 */
export function useLoop(count: number, ms: number | readonly number[], rest = count - 1, amount = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount });
  const reduced = useReduced();
  // Start on the finished frame, so a graphic reads complete before it replays.
  const [tick, setTick] = useState(rest);
  const frame = tick % count;

  useEffect(() => {
    if (!inView || reduced) return;
    const delay = typeof ms === "number" ? ms : ms[frame % ms.length];
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [inView, reduced, frame, tick, ms]);

  return { ref, frame: reduced ? rest : frame, cycle: Math.floor(tick / count), reduced, inView };
}

/**
 * Lifts a block in as it scrolls into view. Content that is already on screen
 * when the page loads (or without JS) is never hidden: only blocks that start
 * below the fold are armed, after hydration.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReduced();
  const inView = useInView(ref, { once: true, margin: "0px 0px -8% 0px" });
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    const top = node.getBoundingClientRect().top;
    if (top > window.innerHeight) {
      const frame = window.requestAnimationFrame(() => setArmed(true));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [reduced]);

  const hidden = armed && !inView;
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={hidden ? { opacity: 0, y: 18 } : { opacity: 1, y: 0 }}
      transition={hidden ? { duration: 0 } : { duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

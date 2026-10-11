"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useInView } from "motion/react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** False on the server and during hydration, so graphics hydrate cleanly. */
export function useReduced() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Steps a looping figure through `count` frames (`ms` per frame, or one delay
 * per frame). Runs only while the figure is on screen; with reduced motion it
 * rests on `rest`, a complete and readable frame. `start` is the first frame.
 */
export function useLoop(count: number, ms: number | readonly number[], rest = count - 1, start = rest) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = useReduced();
  // Starts on the finished frame by default, so the figure reads complete
  // before (and without) any animation.
  const [tick, setTick] = useState(start);
  const frame = tick % count;

  useEffect(() => {
    if (!inView || reduced) return;
    const delay = typeof ms === "number" ? ms : ms[frame % ms.length];
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [inView, reduced, frame, tick, ms]);

  return {
    ref,
    frame: reduced ? rest : frame,
    cycle: reduced ? 0 : Math.floor(tick / count),
    reduced,
  };
}

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MotionConfig, useInView, useReducedMotion } from "motion/react";

/** Root wrapper: motion follows the visitor's reduced-motion setting everywhere below. */
export function DeskMotion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const noop = () => () => {};
const yes = () => true;
const no = () => false;

/**
 * Steps through `count` frames while the element is on screen. With reduced
 * motion it parks on `rest`, the frame that shows the finished picture.
 */
export function useLoop<T extends HTMLElement = HTMLDivElement>(
  count: number,
  durations: number | number[],
  rest: number,
  amount = 0.3,
) {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { amount });
  const prefersReduced = useReducedMotion();
  // The server cannot know the visitor's setting, so hydrate with frame 0 first.
  const hydrated = useSyncExternalStore(noop, yes, no);
  const reduced = hydrated && Boolean(prefersReduced);
  const [frame, setFrame] = useState(0);
  const playing = inView && !reduced;

  useEffect(() => {
    if (!playing) return;
    const ms = Array.isArray(durations) ? durations[frame % durations.length] : durations;
    const timer = window.setTimeout(() => setFrame((value) => (value + 1) % count), ms);
    return () => window.clearTimeout(timer);
  }, [playing, frame, count, durations]);

  return { ref, frame: reduced ? rest : frame, playing, reduced };
}

/** A paper-ish spring: lands with a small bounce. */
export const drop = { type: "spring", stiffness: 320, damping: 22, mass: 0.9 } as const;
export const settle = { type: "spring", stiffness: 210, damping: 26 } as const;

"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePublicSite } from "@/app/_components/site/motion";
import { MotionConfig, MotionGlobalConfig, useInView } from "motion/react";
import { cn } from "@/app/utils/cn";
import { sans, serif } from "./fonts";
import "./design.css";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** False on the server and while hydrating, so the first paint matches. */
export function useCalm() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Steps through `count` frames while the element is on screen. With reduced
 * motion it rests on `rest`, the frame that shows the whole story.
 */
export function useFrames(count: number, ms: number | readonly number[], rest = count - 1, amount = 0.35) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount });
  const calm = useCalm();
  // Starts on the complete frame, and goes back to it whenever the graphic leaves the screen.
  const [tick, setTick] = useState(rest);
  const frame = tick % count;

  useEffect(() => {
    if (calm) return;
    if (!inView) {
      const reset = window.setTimeout(() => setTick(rest), 0);
      return () => window.clearTimeout(reset);
    }
    const delay = typeof ms === "number" ? ms : ms[frame % ms.length];
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [inView, calm, frame, tick, ms, rest]);

  return { ref, frame: calm ? rest : frame, calm, inView };
}

/** The forced-dark root of design 5. Motion jumps to its end state when the visitor asks for less motion. */
export default function Shell({ children, className }: { children: ReactNode; className?: string }) {
  const calm = useCalm();
  useEffect(() => {
    MotionGlobalConfig.skipAnimations = calm;
    return () => {
      MotionGlobalConfig.skipAnimations = false;
    };
  }, [calm]);
  usePublicSite();
  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("d5", sans.variable, serif.variable, className)}>{children}</div>
    </MotionConfig>
  );
}

"use client";

import {
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MotionConfig, MotionGlobalConfig, useInView } from "motion/react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** False on the server and during hydration, so server-rendered graphics hydrate cleanly. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * Marks <html> as a public-site page while mounted, so the in-app "Reduce
 * motion" toggle (on by default) stops freezing CSS animation here; globals.css
 * then follows only the visitor's OS setting.
 */
export function usePublicSite() {
  useInsertionEffect(() => {
    document.documentElement.dataset.publicSite = "";
    return () => {
      delete document.documentElement.dataset.publicSite;
    };
  }, []);
}

/**
 * Wraps the public site. While the visitor asks for reduced motion every Motion
 * animation jumps straight to its end state (Motion's own "user" mode still
 * fades and moves); CSS loops stop in site.css. Leaving the site restores the
 * app's default.
 */
export function SiteMotion({ children }: { children: ReactNode }) {
  usePublicSite();
  const reduced = usePrefersReducedMotion();
  useInsertionEffect(() => {
    MotionGlobalConfig.skipAnimations = reduced;
    return () => {
      MotionGlobalConfig.skipAnimations = false;
    };
  }, [reduced]);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Steps a looping graphic through `count` frames, `ms` apart (a number, or
 * one delay per frame). It only runs while the graphic is on screen, and with
 * reduced motion it rests on `restFrame` (the last frame by default).
 */
export function useLoop(count: number, ms: number | readonly number[], restFrame = count - 1) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduced = usePrefersReducedMotion();
  // Counts up forever so a graphic can tell one pass of the loop from the next.
  const [tick, setTick] = useState(0);
  const frame = tick % count;

  useEffect(() => {
    if (!inView || reduced) return;
    const delay = typeof ms === "number" ? ms : ms[frame % ms.length];
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [inView, reduced, frame, tick, ms]);

  return {
    ref,
    frame: reduced ? restFrame : frame,
    cycle: reduced ? 0 : Math.floor(tick / count),
    reduced,
  };
}

/** Sets --mx/--my on a `.s-spot` card so its border glows under the pointer. */
export function spotlight(event: React.PointerEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
  target.style.setProperty("--my", `${event.clientY - rect.top}px`);
}

"use client";

import { useEffect, useInsertionEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MotionGlobalConfig, animate, inView, type Transition } from "motion/react";
import { cn } from "@/app/utils/cn";

/** Slower than the in-app springs: a scene has to be followed, not just felt. */
export const sceneSpring: Transition = { type: "spring", stiffness: 210, damping: 24, mass: 0.9 };
export const sceneEase: Transition = { duration: 0.45, ease: [0.22, 1, 0.36, 1] };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/** False on the server and during hydration, so server-rendered scenes hydrate cleanly. */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * Mounted once on the landing page. While the visitor asks for reduced motion
 * every Motion animation jumps straight to its end state, including the ones
 * (opacity, size, position) that Motion's own reduced-motion mode keeps.
 * It is an insertion effect so the switch lands before Motion starts the
 * animations of the same commit; leaving the page restores the default.
 */
export function ReducedMotionGate() {
  const reduced = usePrefersReducedMotion();
  useInsertionEffect(() => {
    MotionGlobalConfig.skipAnimations = reduced;
    return () => {
      MotionGlobalConfig.skipAnimations = false;
    };
  }, [reduced]);
  return null;
}

/**
 * Plays a scene as a sequence of steps. It starts when the scene is well into
 * view, waits `delays[n]` ms before moving from step n to n+1, rests on the
 * last step, and rewinds once the scene has scrolled fully away. Interactive
 * scenes move past the timed steps with `setStep`. With Reduce Motion the
 * timed steps are skipped and the scene shows its finished state.
 */
export function useScene(delays: readonly number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState({ running: false, step: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const stopEnter = inView(
      element,
      () => setState((current) => (current.running ? current : { ...current, running: true })),
      { amount: 0.4 },
    );
    const stopLeave = inView(element, () => () => setState({ running: false, step: 0 }));
    return () => {
      stopEnter();
      stopLeave();
    };
  }, []);

  useEffect(() => {
    if (!state.running || state.step >= delays.length) return;
    const timer = setTimeout(
      () => setState((current) => ({ ...current, step: current.step + 1 })),
      delays[state.step],
    );
    return () => clearTimeout(timer);
  }, [state, delays]);

  return {
    ref,
    step: reduced ? Math.max(state.step, delays.length) : state.step,
    setStep: (step: number) => setState((current) => ({ ...current, step })),
  };
}

/**
 * The scaling box around a scene. Scenes below the fold mount only when they
 * near the viewport; the box keeps its height either way, so nothing shifts.
 */
export function SceneBox({
  height,
  label,
  eager = false,
  interactive = false,
  children,
}: {
  /** Height in design pixels, against the 400-pixel design width. */
  height: number;
  label: string;
  eager?: boolean;
  interactive?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);

  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    return inView(element, () => setNear(true), { margin: "400px 0px 400px 0px" });
  }, [near]);

  return (
    <div ref={ref} className="scene-box" role={interactive ? "group" : "img"} aria-label={label}>
      <div className="scene" style={{ height: `calc(var(--u) * ${height})` }}>
        {near ? children : null}
      </div>
    </div>
  );
}

export function MiniWindow({
  title,
  right,
  className,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mini-window flex flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <i className="size-1.5 rounded-full bg-[#ff9db0]" />
          <i className="size-1.5 rounded-full bg-[#ffd27a]" />
          <i className="size-1.5 rounded-full bg-[#8fe3b4]" />
        </span>
        <span className="mini-10 truncate font-medium text-muted-foreground">{title}</span>
        {right ? <span className="ml-auto flex items-center gap-1.5">{right}</span> : null}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** A scene button with a touch target larger than its drawn size. */
export function SceneButton({
  primary = false,
  pulse = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean;
  pulse?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mini-10 relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition-transform duration-100 before:absolute before:-inset-2 active:scale-95 disabled:opacity-50",
        primary ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground",
        pulse && "mini-pulse",
      )}
    >
      {children}
    </button>
  );
}

function TypedRun({ text, speed }: { text: string; speed: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= text.length) return;
    const timer = setTimeout(() => setCount(count + 1), speed);
    return () => clearTimeout(timer);
  }, [count, text, speed]);
  return <>{text.slice(0, count)}</>;
}

/** Text that types itself while `state` is "typing"; empty before, complete after. */
export function Typed({
  text,
  state,
  speed = 42,
}: {
  text: string;
  state: "idle" | "typing" | "done";
  speed?: number;
}) {
  if (state === "idle") return null;
  if (state === "done") return <>{text}</>;
  return <TypedRun key={text} text={text} speed={speed} />;
}

/** How long a step must last for `text` to finish typing, with a short beat after. */
export function typingTime(text: string, speed = 42) {
  return text.length * speed + 350;
}

export function Caret() {
  return <span className="ml-px inline-block h-[1.1em] w-px translate-y-[0.15em] animate-pulse bg-primary" aria-hidden />;
}

/** A number that counts up from zero once `active`; `format` must be a stable function. */
export function CountUp({
  value,
  active,
  format,
  duration = 1.2,
}: {
  value: number;
  active: boolean;
  format: (value: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  // The text is written here rather than rendered, so React never repaints
  // the finished value for a frame before the count starts.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!active || reduced) {
      element.textContent = format(active ? value : 0);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: "easeOut",
      onUpdate: (latest) => {
        element.textContent = format(latest);
      },
    });
    return () => controls.stop();
  }, [active, value, duration, format, reduced]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(0)}
    </span>
  );
}

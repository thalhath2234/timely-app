import { startTransition } from "react";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Marks an overlay open/close as a React transition so `<ViewTransition>` runs. */
export function runViewTransition(update: () => void) {
  if (prefersReducedMotion()) {
    update();
    return;
  }
  startTransition(update);
}

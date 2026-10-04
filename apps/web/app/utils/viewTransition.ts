import { startTransition } from "react";

/** The OS setting, or the in-app "Reduce motion" toggle in Appearance. */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    (document.documentElement.classList.contains("reduce-motion") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
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

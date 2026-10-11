"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function isMacLike() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** The modifier key the two app shortcuts use: "⌘" on Apple devices, "Ctrl"
 * everywhere else. Renders "Ctrl" on the server so hydration matches. */
export function useModKey() {
  return useSyncExternalStore(
    subscribe,
    () => (isMacLike() ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

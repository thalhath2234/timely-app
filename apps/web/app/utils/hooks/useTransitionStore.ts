"use client";

import { useEffect, useState } from "react";
import type { StoreApi } from "zustand";

/**
 * Reads a zustand store slice through React state rather than
 * useSyncExternalStore. React always renders external-store updates
 * synchronously, so an overlay read that way can never start a
 * `<ViewTransition>`. The subscription below runs inside the caller's
 * `startTransition` (see `runViewTransition`), which keeps the update a
 * transition. `selector` must be stable, e.g. defined at module level.
 */
export function useTransitionStore<T, U>(store: StoreApi<T>, selector: (state: T) => U): U {
  const [value, setValue] = useState(() => selector(store.getState()));
  useEffect(() => store.subscribe((state) => setValue(() => selector(state))), [store, selector]);
  return value;
}

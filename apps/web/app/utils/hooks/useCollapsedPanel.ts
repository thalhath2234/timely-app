"use client";

import { useCallback, useSyncExternalStore } from "react";

const COLLAPSED_EVENT = "timely-collapsed-panel";

function readCollapsed(storageKey: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(COLLAPSED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(COLLAPSED_EVENT, onStoreChange);
  };
}

export function useCollapsedPanel(storageKey: string) {
  const getSnapshot = useCallback(() => readCollapsed(storageKey), [storageKey]);
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const toggle = () => {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "0" : "1");
    } catch {
      // Ignore private-mode / blocked storage.
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
  };

  return { collapsed, toggle };
}

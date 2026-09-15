"use client";

import { useState } from "react";

function readCollapsed(storageKey: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function useCollapsedPanel(storageKey: string) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));

  const toggle = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Ignore private-mode / blocked storage.
      }
      return next;
    });
  };

  return { collapsed, toggle };
}

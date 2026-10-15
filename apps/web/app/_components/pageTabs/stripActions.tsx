"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The right end of the tab strip, where the open page puts its own controls. */
export const StripActionsSlot = createContext<HTMLElement | null>(null);

/** Shows a page's save status and actions in the tab strip above it, so the
 * page needs no header row of its own. */
export default function TabStripActions({ children }: { children: ReactNode }) {
  const slot = useContext(StripActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

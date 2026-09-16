"use client";

import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

/**
 * One row in a context menu. `action` runs something, `submenu` nests, and the
 * decorative kinds let callers group related rows without inventing their own
 * markup at each call site.
 */
export type ContextMenuEntry =
  | {
      kind: "action";
      label: string;
      onSelect: () => void;
      icon?: LucideIcon;
      /** Shortcut tokens like "mod+C" or "Shift+X"; rendered per platform. */
      shortcut?: string;
      disabled?: boolean;
      /** Renders in the destructive colour and sits last by convention. */
      danger?: boolean;
      /** Shows a tick; use for toggles and current-value pickers. */
      checked?: boolean;
      /** Small square of colour ahead of the label (statuses, labels, projects). */
      color?: string;
    }
  | {
      kind: "submenu";
      label: string;
      items: ContextMenuEntry[];
      icon?: LucideIcon;
      disabled?: boolean;
    }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

export type ContextMenuRequest = {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  /** Optional caption naming the right-clicked object. */
  title?: string;
};

type ContextMenuState = {
  menu: (ContextMenuRequest & { id: number }) | null;
  open: (request: ContextMenuRequest) => void;
  close: () => void;
};

let nextId = 0;

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  menu: null,
  open: (request) => {
    nextId += 1;
    set({ menu: { ...request, id: nextId } });
  },
  close: () => set({ menu: null }),
}));

export function openContextMenu(request: ContextMenuRequest) {
  useContextMenuStore.getState().open(request);
}

export function closeContextMenu() {
  useContextMenuStore.getState().close();
}

/** Anything a `cond && entry` guard can evaluate to when `cond` is falsy. */
type Falsy = false | null | undefined | "" | 0;

/** Drops separators that ended up leading, trailing, or doubled up once
 * conditional entries were filtered out by the call site. */
export function tidyEntries(entries: (ContextMenuEntry | Falsy)[]): ContextMenuEntry[] {
  const present = entries.filter((entry): entry is ContextMenuEntry => Boolean(entry));
  const out: ContextMenuEntry[] = [];

  for (const entry of present) {
    if (entry.kind === "separator") {
      const previous = out[out.length - 1];
      if (!previous || previous.kind === "separator" || previous.kind === "heading") continue;
    }
    out.push(entry);
  }

  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.kind === "separator" || last.kind === "heading") out.pop();
    else break;
  }

  return out;
}

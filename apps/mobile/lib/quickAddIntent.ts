export type QuickAddKind = "inbox" | "task" | "reminder" | "event" | "doc" | "sheet";

export type QuickAddPreset = {
  kind?: QuickAddKind;
  start?: Date;
  projectId?: string;
  workspaceId?: string;
  /** Prefills the title field, e.g. from a "make a budget sheet" search. */
  title?: string;
};

type Listener = (preset: QuickAddPreset) => void;

const listeners = new Set<Listener>();
/** A request made before the tabs mounted (a launcher shortcut or widget opening the app). */
let pending: QuickAddPreset | null = null;

export function requestQuickAdd(preset: QuickAddPreset = {}) {
  if (listeners.size === 0) {
    pending = preset;
    return;
  }
  listeners.forEach((listener) => listener(preset));
}

export function subscribeQuickAdd(listener: Listener) {
  listeners.add(listener);
  if (pending) {
    const preset = pending;
    pending = null;
    listener(preset);
  }
  return () => {
    listeners.delete(listener);
  };
}

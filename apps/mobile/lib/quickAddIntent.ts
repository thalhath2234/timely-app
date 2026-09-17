export type QuickAddKind = "inbox" | "task" | "reminder" | "event" | "doc" | "sheet";

export type QuickAddPreset = {
  kind?: QuickAddKind;
  start?: Date;
  projectId?: string;
  workspaceId?: string;
};

type Listener = (preset: QuickAddPreset) => void;

const listeners = new Set<Listener>();

export function requestQuickAdd(preset: QuickAddPreset = {}) {
  listeners.forEach((listener) => listener(preset));
}

export function subscribeQuickAdd(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

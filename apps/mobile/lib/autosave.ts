import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { createAutosaveQueue } from "@timely/contract/autosaveQueue";

/** "error": a write failed on the way and is retried on the next flush.
 * "rejected": the server refused a change, which was dropped. */
export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error" | "rejected";

/**
 * Coalesces edits into one debounced write. A write that fails on the way
 * keeps its edits for the next flush; a change the server refuses (a 4xx) is
 * dropped instead, so later edits still save (autosaveQueue.ts).
 */
export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<unknown>,
  delay = 2000,
  options: { onRejected?: (error: unknown, patch: Partial<T>) => void } = {},
) {
  const saveRef = useRef(save);
  const onRejectedRef = useRef(options.onRejected);
  const [queue] = useState(() => createAutosaveQueue<T>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  const inFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (inFlightPromiseRef.current) {
      const ok = await inFlightPromiseRef.current;
      if (!queue.pending()) return ok;
    }

    if (!queue.pending()) {
      return true;
    }

    const work = (async (): Promise<boolean> => {
      inFlightRef.current = true;
      setStatus("saving");
      try {
        const result = await queue.send(
          (patch) => saveRef.current(patch),
          (error, patch) => onRejectedRef.current?.(error, patch),
        );
        setStatus(result.ok ? "saved" : result.error !== undefined ? "error" : "rejected");
        return result.ok;
      } finally {
        inFlightRef.current = false;
        inFlightPromiseRef.current = null;
      }
    })();

    inFlightPromiseRef.current = work;
    return work;
  }, [queue]);

  useEffect(() => {
    saveRef.current = save;
    onRejectedRef.current = options.onRejected;
    flushRef.current = () => void flush();
  });

  const schedule = useCallback(
    (patch: Partial<T>) => {
      queue.add(patch);
      setStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flushRef.current(), delay);
    },
    [delay, queue],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (queue.pending()) flushRef.current();
    };
  }, [queue]);

  const hasUnsavedChanges = useCallback(
    () => queue.pending() || inFlightRef.current,
    [queue],
  );

  return { schedule, flush, retry: flush, status, hasUnsavedChanges };
}

export function saveStatusLabel(status: SaveStatus) {
  switch (status) {
    case "unsaved":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    case "rejected":
      return "Change not saved";
    default:
      return "";
  }
}

export type UnsavedLeaveGuardOptions = {
  /**
   * Runs when navigation away is intercepted with unsaved work. Resolve true
   * once everything is saved and the screen may close without asking; resolve
   * false (or reject) to show the confirmation instead.
   */
  beforeLeave?: () => Promise<boolean>;
};

export function useUnsavedLeaveGuard(hasUnsaved: () => boolean, options: UnsavedLeaveGuardOptions = {}) {
  const navigation = useNavigation();
  const pendingActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const dispatchActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const beforeLeaveRef = useRef(options.beforeLeave);
  const [allowNavigation, setAllowNavigation] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  useEffect(() => {
    beforeLeaveRef.current = options.beforeLeave;
  });

  const leave = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setConfirmingLeave(false);
    if (!action) return;
    dispatchActionRef.current = action;
    setAllowNavigation(true);
  }, []);

  usePreventRemove(hasUnsaved() && !allowNavigation, ({ data }) => {
    pendingActionRef.current = data.action;
    const beforeLeave = beforeLeaveRef.current;
    if (!beforeLeave) {
      setConfirmingLeave(true);
      return;
    }
    beforeLeave().then(
      (saved) => {
        if (pendingActionRef.current !== data.action) return;
        if (saved) leave();
        else setConfirmingLeave(true);
      },
      () => {
        if (pendingActionRef.current === data.action) setConfirmingLeave(true);
      },
    );
  });

  useEffect(() => {
    if (!allowNavigation) return;
    const action = dispatchActionRef.current;
    dispatchActionRef.current = null;
    if (action) navigation.dispatch(action);
    const timer = setTimeout(() => setAllowNavigation(false), 0);
    return () => clearTimeout(timer);
  }, [allowNavigation, navigation]);

  const stay = useCallback(() => {
    const action = pendingActionRef.current;
    setConfirmingLeave(false);
    // ConfirmSheet closes before it invokes onConfirm. Clear a cancelled action
    // on the next tick so the confirm callback can still dispatch it.
    setTimeout(() => {
      if (pendingActionRef.current === action) pendingActionRef.current = null;
    }, 0);
  }, []);

  return { confirmingLeave, stay, leave };
}

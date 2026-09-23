import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation } from "expo-router";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<unknown>,
  delay = 2000,
) {
  const saveRef = useRef(save);
  const pendingRef = useRef<Partial<T> | null>(null);
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
      if (!pendingRef.current) return ok;
    }

    if (!pendingRef.current) {
      return true;
    }

    const work = (async (): Promise<boolean> => {
      try {
        while (pendingRef.current) {
          const patch = pendingRef.current;
          pendingRef.current = null;
          inFlightRef.current = true;
          setStatus("saving");
          try {
            await saveRef.current(patch);
            inFlightRef.current = false;
            setStatus(pendingRef.current ? "unsaved" : "saved");
          } catch {
            pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
            inFlightRef.current = false;
            setStatus("error");
            return false;
          }
        }
        return true;
      } finally {
        inFlightPromiseRef.current = null;
      }
    })();

    inFlightPromiseRef.current = work;
    return work;
  }, []);

  useEffect(() => {
    saveRef.current = save;
    flushRef.current = () => void flush();
  });

  const schedule = useCallback(
    (patch: Partial<T>) => {
      pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
      setStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flushRef.current(), delay);
    },
    [delay],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) flushRef.current();
    };
  }, []);

  const hasUnsavedChanges = useCallback(
    () => pendingRef.current !== null || inFlightRef.current,
    [],
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
    default:
      return "";
  }
}

export function useUnsavedLeaveGuard(hasUnsaved: () => boolean) {
  const navigation = useNavigation();
  const pendingActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const allowNextRemoveRef = useRef(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  useEffect(() => {
    const sub = navigation.addListener("beforeRemove", (event) => {
      if (allowNextRemoveRef.current) {
        allowNextRemoveRef.current = false;
        return;
      }
      if (!hasUnsaved()) return;
      event.preventDefault();
      pendingActionRef.current = event.data.action;
      setConfirmingLeave(true);
    });
    return sub;
  }, [hasUnsaved, navigation]);

  const stay = useCallback(() => {
    const action = pendingActionRef.current;
    setConfirmingLeave(false);
    // ConfirmSheet closes before it invokes onConfirm. Clear a cancelled action
    // on the next tick so the confirm callback can still dispatch it.
    setTimeout(() => {
      if (pendingActionRef.current === action) pendingActionRef.current = null;
    }, 0);
  }, []);

  const leave = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setConfirmingLeave(false);
    if (!action) return;
    allowNextRemoveRef.current = true;
    navigation.dispatch(action);
    setTimeout(() => {
      allowNextRemoveRef.current = false;
    }, 0);
  }, [navigation]);

  return { confirmingLeave, stay, leave };
}

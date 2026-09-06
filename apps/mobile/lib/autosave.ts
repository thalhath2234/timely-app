import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<unknown>,
  delay = 800,
) {
  const saveRef = useRef(save);
  const pendingRef = useRef<Partial<T> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<SaveStatus>("idle");

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const patch = pendingRef.current;
    if (inFlightRef.current || !patch) return;

    pendingRef.current = null;
    inFlightRef.current = true;
    setStatus("saving");

    try {
      await saveRef.current(patch);
      setStatus(pendingRef.current ? "unsaved" : "saved");
    } catch {
      pendingRef.current = { ...patch, ...(pendingRef.current ?? {}) };
      setStatus("error");
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) {
        timerRef.current = setTimeout(() => flushRef.current(), delay);
      }
    }
  }, [delay]);

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

  const hasUnsavedChanges = () =>
    pendingRef.current !== null || inFlightRef.current;

  return { schedule, flush, status, hasUnsavedChanges };
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
      return "Save failed — retrying";
    default:
      return "";
  }
}

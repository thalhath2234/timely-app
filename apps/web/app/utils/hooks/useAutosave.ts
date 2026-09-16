"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

/**
 * Coalesces rapid edits into a single debounced write. Patches queued while a
 * request is in flight are merged and sent once it settles, and a failed write
 * keeps its patch so the next flush retries it.
 */
export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<unknown>,
  delay = 800,
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

  const hasUnsavedChanges = () =>
    pendingRef.current !== null || inFlightRef.current;

  // Warn on tab close and make a best effort to persist on unmount.
  useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (pendingRef.current) event.preventDefault();
    };

    window.addEventListener("beforeunload", warnIfUnsaved);

    return () => {
      window.removeEventListener("beforeunload", warnIfUnsaved);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) flushRef.current();
    };
  }, []);

  return { schedule, flush, retry: flush, status, hasUnsavedChanges };
}

export function saveStatusLabel(status: SaveStatus) {
  switch (status) {
    case "unsaved":
      return "Unsaved changes";
    case "saving":
      return "Saving...";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}

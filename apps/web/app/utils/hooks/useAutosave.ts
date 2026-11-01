"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosaveQueue, type AutosaveOutcome } from "@timely/contract/autosaveQueue";

export type { AutosaveOutcome };

/** "error": a write failed on the way and Retry can send it again.
 * "rejected": the server refused a change, which was dropped. */
export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error" | "rejected";

type Options<T> = {
  /** Hears each change the server refused, after it was dropped. */
  onRejected?: (error: unknown, patch: Partial<T>) => void;
};

/**
 * Coalesces rapid edits into a single debounced write. Edits queued while a
 * request is in flight are sent once it settles. A write that fails on the way
 * keeps its edits so the next flush retries them; a change the server refuses
 * (a 4xx) is dropped instead, so later edits still save (autosaveQueue.ts).
 */
export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<unknown>,
  delay = 800,
  options: Options<T> = {},
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

  /** Queues an edit and writes it at once; resolves with what became of it. */
  const saveNow = useCallback(
    (patch: Partial<T>) =>
      new Promise<AutosaveOutcome>((resolve) => {
        queue.add(patch, resolve);
        setStatus("unsaved");
        void flush();
      }),
    [flush, queue],
  );

  const hasUnsavedChanges = () => queue.pending() || inFlightRef.current;

  // Warn on tab close and make a best effort to persist on unmount.
  useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (queue.pending()) event.preventDefault();
    };

    window.addEventListener("beforeunload", warnIfUnsaved);

    return () => {
      window.removeEventListener("beforeunload", warnIfUnsaved);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (queue.pending()) flushRef.current();
    };
  }, [queue]);

  return { schedule, saveNow, flush, retry: flush, status, hasUnsavedChanges };
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
    case "rejected":
      return "Change not saved";
    default:
      return "";
  }
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { saveStatusLabel, type SaveStatus } from "@/app/utils/hooks/useAutosave";

export default function SaveStatusBadge({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry?: () => void;
}) {
  const saved = status === "saved";

  return (
    <AnimatePresence>
      {status === "idle" ? null : (
        <motion.span
          key={status}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className={`size-1.5 rounded-full ${
              status === "error"
                ? "bg-destructive"
                : status === "saving" || status === "unsaved"
                  ? "bg-warning"
                  : "bg-success"
            } ${saved ? "animate-pulse" : ""}`}
          />
          {saved ? "Saved just now" : saveStatusLabel(status)}
          {status === "error" && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          ) : null}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

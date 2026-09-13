"use client";

import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import * as motion from "motion/react-client";
import { AlertTriangle, Check, Sparkles, X } from "lucide-react";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import { cn } from "@/app/utils/cn";

/** Floating status shown while an explicit Auto-schedule apply runs and after
 * it lands, so the outcome is visible even once the dialog is closed. */
export default function AutoScheduleIndicator({
  className,
}: {
  className?: string;
}) {
  const { status, message, dismiss } = useScheduleActivityStore();

  useEffect(() => {
    if (status !== "done" && status !== "error") return;
    const timer = window.setTimeout(dismiss, 4500);
    return () => window.clearTimeout(timer);
  }, [status, dismiss]);

  const visible = status !== "idle";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.16 }}
          className={cn(
            "pointer-events-auto z-50 flex max-w-sm items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm shadow-xl",
            className ?? "fixed bottom-4 right-4",
            status === "error"
              ? "border-destructive/30 bg-popover text-destructive"
              : "border-border bg-popover text-popover-foreground",
          )}
        >
          {status === "running" ? (
            <Sparkles className="size-4 shrink-0 animate-pulse text-primary" />
          ) : status === "error" ? (
            <AlertTriangle className="size-4 shrink-0" />
          ) : (
            <Check className="size-4 shrink-0 text-primary" />
          )}
          <p className="min-w-0 flex-1 leading-snug">{message}</p>
          {status === "running" ? (
            <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          ) : (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

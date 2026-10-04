"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Sparkles, X } from "lucide-react";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import { cn } from "@/app/utils/cn";
import { springSoft, toastVariants } from "@/app/_components/_ui/motion";

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
          variants={toastVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={springSoft}
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
            <LogoSpinner size={14} label="Auto-scheduling" />
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

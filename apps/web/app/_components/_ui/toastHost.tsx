"use client";

import { AnimatePresence, motion } from "motion/react";
import { useToastStore } from "@/app/_store/toastStore";
import { springSoft, toastVariants } from "@/app/_components/_ui/motion";

export default function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-80 flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={springSoft}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
          >
            <p className="min-w-0 flex-1">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-primary"
                onClick={() => {
                  toast.action?.onAction();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground"
              onClick={() => dismiss(toast.id)}
            >
              Dismiss
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

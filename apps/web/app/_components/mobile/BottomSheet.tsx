"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

/** The phone frame element every sheet is portaled into. */
export const SHEET_PORTAL_ID = "m-sheet-root";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Pinned below the scrollable body, for primary actions. */
  footer?: ReactNode;
}

/**
 * Slide-up sheet constrained to the phone frame. Portaled to the shell root
 * (not document.body) so it stays inside the device mockup on desktop widths
 * and so sheets opened from inside another sheet still cover the whole frame.
 */
export default function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(SHEET_PORTAL_ID));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!host) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="absolute inset-0 z-40 flex flex-col justify-end">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[92%] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-popover text-popover-foreground shadow-2xl pb-safe"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
            </div>
            {title ? (
              <div className="px-5 pt-1 pb-2">
                <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 scrollbar-none">
              {children}
            </div>
            {footer ? (
              <div className="shrink-0 border-t border-border bg-popover px-4 pt-3 pb-4">{footer}</div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    host,
  );
}

export function SheetOption({
  selected,
  onSelect,
  children,
  leading,
}: {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors active:bg-muted ${
        selected ? "bg-accent text-accent-foreground" : "text-foreground"
      }`}
    >
      {leading}
      <span className="flex-1">{children}</span>
      {selected ? <span className="text-xs font-medium">Selected</span> : null}
    </button>
  );
}

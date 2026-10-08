"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";

export default function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  pendingLabel = "Deleting…",
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!pending) onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, pending]);

  // Desktop app: put the mouse pointer on Cancel, like Windows' "Snap To",
  // so the dialog is under the pointer without landing on Delete.
  useEffect(() => {
    const button = cancelRef.current;
    const snapPointer = window.timelyDesktop?.snapPointer;
    if (!button || !snapPointer) return;
    const rect = button.getBoundingClientRect();
    snapPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <OverlayScrim
        className="z-[70] bg-black/55"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || pending) return;
          onCancel();
        }}
      />
      <OverlayFrame className="z-[70] items-center justify-center p-4">
        <OverlayPanel
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className="relative w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <Trash2 className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={titleId} className="text-sm font-semibold text-foreground">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm leading-snug text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="rounded-lg bg-destructive-container px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive-container/90 disabled:opacity-60"
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}

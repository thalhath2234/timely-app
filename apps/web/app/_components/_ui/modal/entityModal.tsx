"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import Button from "@/app/_components/_ui/button";

/** Title field shared by the detail panel and the create modals. */
export const modalTitleClass =
  "w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50";

export function EntityModalShell({
  icon: Icon,
  label,
  headerLeft,
  headerRight,
  footer,
  size = "md",
  onClose,
  children,
}: {
  icon: LucideIcon;
  label: string;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "xl";
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <OverlayScrim
        className="z-50 bg-black/70 backdrop-blur-[6px]"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // Slash/mention menus render on document.body above this overlay.
          // Closing here would discard the description when picking a command.
          if (document.querySelector("[data-caret-popup]")) return;
          onClose();
        }}
      />
      <OverlayFrame className="z-50 items-center justify-center p-3 md:p-6">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          className={cn(
            "relative flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-black/40",
            size === "xl"
              ? "h-[min(942px,calc(100vh-2rem))] max-w-6xl"
              : "h-[min(860px,calc(100vh-2rem))] max-w-5xl",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-5">
            {headerLeft ?? (
              <>
                <Icon className="size-4 text-muted-foreground" />
                <span className="flex-1 text-sm capitalize text-muted-foreground">
                  {label}
                </span>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">{headerRight}</div>

            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-3.5" />
            </button>
          </header>

          {/* Below lg the two columns stack and scroll together; side by side
              each column scrolls on its own. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">{children}</div>
          {footer}
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}

export function ModalMain({
  children,
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col px-7 py-6 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ModalSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-border bg-muted/10 px-5 py-5 lg:w-[360px] lg:overflow-y-auto lg:border-l lg:border-t-0">
      {children}
    </aside>
  );
}

export function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40">
      <span className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span title={label} className="truncate">
          {label}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{children}</div>
    </div>
  );
}

export function SidebarSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

/** Title field of a create dialog. */
export const createTitleClass =
  "w-full bg-transparent text-[26px] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50";

/**
 * The desktop create dialog (docs/design-system.md#sheets-and-create-forms):
 * header with a kind chip and close, a body as tall as its content, and a
 * footer with a one-line summary, Cancel and the one primary action. It sits
 * near the top of the screen so it grows downward when "More" opens.
 */
export function CreateDialogShell({
  label,
  header,
  footer,
  size = "md",
  onClose,
  children,
}: {
  label: string;
  header: ReactNode;
  footer: ReactNode;
  size?: "sm" | "md";
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <OverlayScrim
        className="z-50 bg-black/60 backdrop-blur-[4px]"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // Slash/mention menus render on document.body above this overlay.
          if (document.querySelector("[data-caret-popup]")) return;
          onClose();
        }}
      />
      <OverlayFrame className="z-50 items-start justify-center p-3 pt-[10vh] md:px-6">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={cn(
            "relative flex max-h-[calc(90vh-1.5rem)] w-full flex-col overflow-hidden rounded-[20px] border border-border bg-background shadow-2xl shadow-black/40",
            size === "sm" ? "max-w-[560px]" : "max-w-[720px]",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">{header}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
          {footer}
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}

/** Summary of what will be created, then Cancel and the primary action. */
export function CreateDialogFooter({
  summary,
  error,
  onCancel,
  children,
}: {
  summary?: ReactNode;
  error?: ReactNode;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <footer className="flex min-h-15 shrink-0 items-center gap-2 border-t border-border bg-muted/20 py-3 pl-6 pr-4">
      <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" data-testid="create-summary">
        {summary}
      </p>
      {error ? <span className="shrink-0 text-xs text-destructive">{error}</span> : null}
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {children}
    </footer>
  );
}

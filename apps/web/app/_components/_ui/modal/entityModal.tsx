"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";

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
  closeWithKbd = false,
  onClose,
  children,
}: {
  icon: LucideIcon;
  label: string;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "xl";
  closeWithKbd?: boolean;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
      <OverlayScrim
        className="bg-black/70 backdrop-blur-[6px]"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // Slash/mention menus render on document.body above this overlay.
          // Closing here would discard the description when picking a command.
          if (document.querySelector("[data-caret-popup]")) return;
          onClose();
        }}
      />
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
            {closeWithKbd ? (
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </kbd>
            ) : null}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">{children}</div>
        {footer}
      </OverlayPanel>
    </div>
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
        "flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-6",
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
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-muted/10 px-5 py-5 lg:w-[360px] lg:border-l lg:border-t-0">
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

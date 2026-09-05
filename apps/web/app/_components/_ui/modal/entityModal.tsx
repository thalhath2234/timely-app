"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/app/utils/cn";

/** Title field shared by the detail panel and the create modals. */
export const modalTitleClass =
  "w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50";

export function EntityModalShell({
  icon: Icon,
  label,
  headerRight,
  onClose,
  children,
}: {
  icon: LucideIcon;
  label: string;
  headerRight?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[min(860px,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm capitalize text-muted-foreground">
            {label}
          </span>

          {headerRight}

          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">{children}</div>
      </div>
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
        "flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ModalSidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-muted/15 px-4 py-4 lg:w-80 lg:border-l lg:border-t-0">
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
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span
        title={label}
        className="w-20 shrink-0 truncate text-xs text-muted-foreground"
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

export function SidebarSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}

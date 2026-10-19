"use client";

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/app/utils/cn";

/**
 * Grouped rows, the desktop twin of the phone's SettingsList
 * (docs/design-system.md#sheets-and-create-forms): one card with hairline
 * dividers, each row a label on the left and its value or control on the
 * right. Used by the create dialog and the task details panel.
 */

/** The value on the right of a grouped row: Select and DatePicker `variant="row"`. */
export const rowValueClass =
  "-mr-1.5 inline-flex h-8 min-w-0 cursor-pointer items-center justify-end gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0";

export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <div className={cn("overflow-hidden rounded-[12px] border border-border bg-card", className)}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? <div aria-hidden className="ml-3.5 h-px bg-border" /> : null}
          {row}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A row: `label` on the left, `children` (a `variant="row"` Select or
 * DatePicker, a switch, a bare input) on the right. With `onClick` and no
 * children the whole row is a button with a chevron.
 */
export function ListRow({
  label,
  meta,
  icon,
  children,
  onClick,
  tone = "default",
  className,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  /** Second line under the label. */
  meta?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  /** "add" draws a "+ New …" row in the accent; "danger" a destructive one. */
  tone?: "default" | "add" | "danger";
  className?: string;
  "aria-label"?: string;
}) {
  const body = (
    <>
      {tone === "add" && !icon ? <Plus className="size-4 shrink-0 text-primary" /> : icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            tone === "add" ? "text-primary" : tone === "danger" ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </span>
        {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
      {children ? <span className="flex min-w-0 max-w-[65%] shrink-0 items-center justify-end gap-1.5">{children}</span> : null}
      {onClick && tone === "default" && !children ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const base = cn("flex w-full items-center gap-2.5 px-3.5 text-left", meta ? "min-h-12 py-1.5" : "min-h-10", className);
  if (onClick) {
    return (
      <button type="button" aria-label={ariaLabel} onClick={onClick} className={cn(base, "cursor-pointer transition-colors hover:bg-muted/50")}>
        {body}
      </button>
    );
  }
  return <div className={base}>{body}</div>;
}

/** A small heading above a group, with an optional count or action on the right. */
export function GroupLabel({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-1 pb-1.5 pt-1", className)}>
      <span className="text-[13px] font-semibold text-foreground">{children}</span>
      {aside ? <span className="text-xs font-medium text-muted-foreground">{aside}</span> : null}
    </div>
  );
}

/** A line of muted help under a group. */
export function GroupHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-1 pt-1.5 text-xs leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** Timely's drawn on/off switch for a grouped row. */
export function ListSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/25",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/**
 * A property of a new item as a chip (Project, Priority, Due …), the desktop
 * twin of the phone's PropertyChip. Select, DatePicker and ColorPicker take
 * `variant="chip"` to draw their trigger this way.
 * Spec: docs/design-system.md#sheets-and-create-forms.
 */
export function propertyChipClass({
  empty,
  active,
  className,
}: { empty?: boolean; active?: boolean; className?: string } = {}) {
  return cn(
    "inline-flex h-8 max-w-[260px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 aria-expanded:ring-2 aria-expanded:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
    active
      ? "bg-accent text-accent-foreground hover:bg-primary/15"
      : empty
        ? "border border-dashed border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
        : "bg-muted text-foreground hover:bg-accent hover:text-accent-foreground",
    className,
  );
}

type PropertyChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  empty?: boolean;
  active?: boolean;
};

/** A chip that is a plain button: a toggle (All day) or the "More" disclosure. */
export const PropertyChip = forwardRef<HTMLButtonElement, PropertyChipProps>(function PropertyChip(
  { icon, empty, active, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={propertyChipClass({ empty, active, className })} {...rest}>
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
});

/** The wrapping row of chips under a create form's title. */
export function PropertyChips({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-1.5", className)}>{children}</div>;
}

"use client";

import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";

export type SegmentOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; title?: string };

/**
 * One segmented control for switching views or modes (List/Kanban,
 * Day/Week/Month, All/Docs/Sheets, System/Light/Dark). A muted track with the
 * active segment raised on a card. Same look as the phone's SegmentedControl.
 * Spec: docs/design-system.md#segmented-control.
 */
export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  fill = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  /** sm 28px tall, md 32px (matches Button and Input heights). */
  size?: "sm" | "md";
  /** Stretch segments to the full width. */
  fill?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5",
        size === "sm" ? "h-7" : "h-8",
        fill && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-full cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 font-medium transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
              size === "sm" ? "text-xs" : "text-sm",
              fill && "flex-1",
              active
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/** The count beside a board section's label: muted, or in the warning wash for "Needs you". */
export function CountPill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "attn";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "attn"
          ? "bg-warning/12 text-warning-text"
          : "bg-fill text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** A small status pill on a card ("Was it worth it?", "From Claude Code", "Later"). */
export function Pill({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "primary" | "warning";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium [&_svg]:size-3",
        tone === "primary"
          ? "bg-primary/12 text-primary"
          : tone === "warning"
            ? "bg-warning/12 text-warning-text"
            : "bg-fill text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

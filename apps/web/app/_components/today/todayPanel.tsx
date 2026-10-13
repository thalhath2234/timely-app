"use client";

import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/** One block of the Today board: a kit card with a sentence-case title, an
 * optional line of meta text and an action on the right. */
export default function TodayPanel({
  title,
  icon,
  meta,
  action,
  children,
  className,
  titleClassName,
  ...rest
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  titleClassName?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-card p-4", className)} {...rest}>
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className={cn("flex shrink-0 items-center gap-1.5 text-sm font-semibold text-foreground", titleClassName)}>
          {icon}
          {title}
        </h2>
        <div className="flex min-w-0 items-center justify-end gap-2 text-xs text-muted-foreground">
          {meta}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

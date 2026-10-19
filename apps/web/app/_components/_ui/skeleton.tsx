"use client";

import type { CSSProperties } from "react";
import { cn } from "@/app/utils/cn";

/**
 * Loading placeholders (catalogue item 14): a page shows the shape of what
 * is coming and cross-fades to it, never a spinner or a "Loading…" line.
 * Content revealed by `PageFade`, `Reveal` or `revealProps` supplies the
 * cross-fade when the data lands.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted/70", className)} style={style} />;
}

/** `rows` list rows of `height` px: a dot, a title of varying width and a short value on the right. */
export function SkeletonRows({
  rows = 5,
  height = 46,
  className,
  bare = false,
}: {
  rows?: number;
  height?: number;
  className?: string;
  /** No card around the rows. */
  bare?: boolean;
}) {
  const widths = ["58%", "42%", "66%", "36%", "50%", "61%", "44%", "55%"];
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className={cn(!bare && "overflow-hidden rounded-[12px] border border-border bg-card", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn("flex items-center gap-3 px-3", index > 0 && !bare && "border-t border-border")}
          style={{ height }}
        >
          <Skeleton className="size-2.5 shrink-0 rounded-full" />
          <Skeleton className="h-3.5" style={{ width: widths[index % widths.length] }} />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A grid of `count` card shapes: a title line and two text lines each. */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-[12px] border border-border bg-card p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-4 h-7 w-16" />
          <Skeleton className="mt-3 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** Text-shaped lines, for a paragraph or a short block inside a card. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ["92%", "76%", "84%", "60%"];
  return (
    <div aria-busy="true" aria-label="Loading" className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="h-3" style={{ width: widths[index % widths.length] }} />
      ))}
    </div>
  );
}

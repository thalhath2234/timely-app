"use client";

import Link from "next/link";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/**
 * The layout system for app pages (docs/design-system.md#page-with-rail):
 * the page's own content on the left and a rail of supporting cards on the
 * right, 300-340 px wide from xl (1280 px) up, so wide windows carry the
 * numbers and next steps instead of empty space. Narrower windows put the
 * rail's cards under the content, two per row, so nothing is hidden.
 */
export default function PageWithRail({
  children,
  rail,
  railWidth = 320,
  sticky = false,
  className,
  railClassName,
  ...rest
}: {
  children: ReactNode;
  /** `RailSection` cards; none means a plain page. */
  rail?: ReactNode;
  /** px, 300 to 340. */
  railWidth?: number;
  /** Keep the rail in view while a long page scrolls (only for a short rail). */
  sticky?: boolean;
  className?: string;
  railClassName?: string;
} & HTMLAttributes<HTMLDivElement>) {
  if (!rail) {
    return (
      <div className={className} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn("grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_var(--rail-width)]", className)}
      style={{ "--rail-width": `${railWidth}px` } as CSSProperties}
      {...rest}
    >
      <div className="min-w-0">{children}</div>
      <aside
        className={cn(
          "grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1",
          sticky && "xl:sticky xl:top-0",
          railClassName,
        )}
      >
        {rail}
      </aside>
    </div>
  );
}

/** One card of a rail (or of the Today board): a sentence-case title with
 * an optional icon, a line of meta text and an action on the right. */
export function RailSection({
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
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={cn("min-w-0 rounded-[12px] border border-border bg-card p-4", className)} {...rest}>
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className={cn("flex min-w-0 shrink items-center gap-1.5 text-sm font-semibold text-foreground", titleClassName)}>
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {meta || action ? (
          <div className="flex min-w-0 shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground">
            {meta}
            {action}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Rows inside a rail card: hairlines between them, no padding of their own. */
export function RailRows({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("flex flex-col", className)}>{children}</ul>;
}

/**
 * A grouped row for a rail card: a colour dot and label on the left, the
 * value (a number, a date, a switch) on the right, an optional second line
 * and a thin share bar under the label. Clickable with `onClick` or `href`.
 */
export function RailRow({
  label,
  value,
  meta,
  color,
  share,
  onClick,
  href,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  meta?: ReactNode;
  /** A dot in this colour before the label. */
  color?: string | null;
  /** 0 to 1: a thin bar under the label, for "how much of the whole". */
  share?: number;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "muted" | "danger" | "primary";
  className?: string;
}) {
  const valueClass = cn(
    "shrink-0 text-sm tabular-nums",
    tone === "danger"
      ? "font-medium text-destructive"
      : tone === "primary"
        ? "font-semibold text-primary"
        : tone === "muted"
          ? "text-muted-foreground"
          : "font-medium text-foreground",
  );
  const line = (
    <span className="flex w-full items-center gap-2.5">
      {color ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{label}</span>
        {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
      {value !== undefined && value !== null ? <span className={valueClass}>{value}</span> : null}
    </span>
  );
  const body =
    share === undefined ? (
      line
    ) : (
      <>
        {line}
        <span aria-hidden className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`, backgroundColor: color || "var(--primary)" }}
          />
        </span>
      </>
    );
  const base = cn(
    "flex w-full flex-col items-stretch border-t border-border py-2 text-left first:border-t-0",
    (onClick || href) && "cursor-pointer transition-colors hover:text-primary [&_.truncate]:hover:text-primary",
    className,
  );
  if (href) {
    return (
      <li className="min-w-0">
        <Link href={href} className={base}>
          {body}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li className="min-w-0">
        <button type="button" onClick={onClick} className={base}>
          {body}
        </button>
      </li>
    );
  }
  return <li className={base}>{body}</li>;
}

/** A quiet line in a rail card when there is nothing to list. */
export function RailEmpty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** The film's stat: a big number over a small label, for the top of a rail card. */
export function RailStat({ value, label, tone = "default" }: { value: ReactNode; label: ReactNode; tone?: "default" | "primary" | "warning" | "destructive" | "success" }) {
  const color =
    tone === "primary"
      ? "text-primary"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : tone === "success"
            ? "text-success"
            : "text-foreground";
  return (
    <div className="min-w-0">
      <span className={cn("block text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums", color)}>{value}</span>
      <span className="block truncate text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

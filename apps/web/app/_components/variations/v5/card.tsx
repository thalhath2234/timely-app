import type { CSSProperties, ReactNode } from "react";
import { Check, GripVertical } from "lucide-react";
import { cn } from "@/app/utils/cn";

/**
 * One dashboard card, with the app's chrome: a grip and a small uppercase
 * title at the top, a resize corner at the bottom right (drawn in CSS).
 */
export function Card({
  title,
  right,
  children,
  className,
  style,
  as: Tag = "div",
  bodyClassName,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "li" | "article";
  bodyClassName?: string;
}) {
  return (
    <Tag className={cn("v5-card", className)} style={style}>
      <CardHead title={title} right={right} />
      <div className={cn("v5-card-body", bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function CardHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="v5-card-head">
      <GripVertical aria-hidden className="v5-grip size-3.5" strokeWidth={2.2} />
      <span className="v5-card-title truncate">{title}</span>
      {right ? <span className="v5-head-right">{right}</span> : null}
    </div>
  );
}

/** A big tabular number with the app's coloured bar at its left. */
export function Num({
  children,
  unit,
  color = "var(--v-primary)",
  className,
}: {
  children: ReactNode;
  unit?: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span className={cn("v5-num", className)} style={{ "--c": color } as CSSProperties}>
      <span className="v5-num-bar" aria-hidden />
      <span>{children}</span>
      {unit ? <span className="v5-num-unit">{unit}</span> : null}
    </span>
  );
}

/** A ring meter; `value` is 0 to 1. */
export function Ring({
  value,
  color = "var(--v-primary)",
  size,
  stroke = 6,
  children,
  className,
}: {
  value: number;
  color?: string;
  /** A CSS length; leave it out to size it with a `[--size:…]` utility. */
  size?: string;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      className={cn("v5-ring", className)}
      style={{ "--c": color, "--size": size, "--stroke": `${stroke}px` } as CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 48 48">
        <circle className="track" cx="24" cy="24" r={r} />
        <circle
          className="value"
          cx="24"
          cy="24"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, value)))}
        />
      </svg>
      {children ? <span className="absolute inset-0 flex items-center justify-center">{children}</span> : null}
    </span>
  );
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return (
    <span className="v5-meter block" style={{ "--c": color } as CSSProperties} aria-hidden>
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

export function Checkbox({ on }: { on: boolean }) {
  return (
    <span className="v5-check" data-on={on} aria-hidden>
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/** The label above a row of cards: small caps, a rule, and a count. */
export function RowHead({ label, count, id }: { label: string; count?: ReactNode; id?: string }) {
  return (
    <p className="v5-row-head" id={id}>
      <span>{label}</span>
      {count !== undefined ? <span className="v5-badge">{count}</span> : null}
    </p>
  );
}

"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";

/**
 * Timely's one button. Every clickable action that looks like a button uses
 * this (or `buttonClass` for a Link), so heights, corners, weights and states
 * match on every screen. Spec: docs/design-system.md#button.
 *
 * - primary: the one main action of a screen, dialog or form.
 * - secondary: a filled neutral action next to a primary one.
 * - outline: a page-level action that is not the main one (Import, Duplicate).
 * - ghost: toolbar and row actions; no chrome until hover.
 * - destructive: deletes or signs out; use in confirmations.
 * - destructive-ghost: a quiet Delete or Log out beside other actions.
 * - soft: an accent-tinted suggestion (a suggested next step, Auto-schedule).
 * - link: an inline text action inside copy or a row ("Review", "Open").
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "soft"
  | "destructive"
  | "destructive-ghost"
  | "link";
/** sm 28px (rows, toolbars), md 32px (default), lg 36px (beside a form field). */
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
  outline: "border border-border bg-card text-foreground shadow-xs hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  soft: "bg-accent text-accent-foreground hover:bg-primary/15",
  destructive: "bg-destructive-container text-destructive-foreground shadow-xs hover:bg-destructive-container/90",
  "destructive-ghost": "text-destructive hover:bg-destructive/10",
  link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-8 px-3 text-sm [&_svg]:size-4",
  lg: "h-9 px-4 text-sm [&_svg]:size-4",
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "size-7 [&_svg]:size-3.5",
  md: "size-8 [&_svg]:size-4",
  lg: "size-9 [&_svg]:size-4",
};

/** Class names for a button-styled element that is not a <button> (a Link). */
export function buttonClass({
  variant = "primary",
  size = "md",
  icon = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; className?: string } = {}) {
  return cn(
    base,
    variants[variant],
    variant === "link" ? (size === "sm" ? "text-xs" : "text-sm") : icon ? iconSizes[size] : sizes[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square, icon-only button; pass an aria-label. */
  icon?: boolean;
  /** Shows the Timely spinner in place of `leading` and disables the button. */
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, loading, leading, trailing, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const spinner = (
    <LogoSpinner size={size === "sm" ? 12 : 14} tone={variant === "primary" || variant === "destructive" ? "mono" : undefined} />
  );
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, icon, className })}
      {...rest}
    >
      {loading ? spinner : leading}
      {children}
      {trailing}
    </button>
  );
});

export default Button;

/** A keyboard shortcut hint shown inside a button or menu row. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded border border-current/20 px-1 font-sans text-[10px] font-medium leading-none opacity-70",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

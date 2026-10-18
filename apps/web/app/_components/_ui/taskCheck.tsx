"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { motion } from "motion/react";
import { motion as MOTION } from "@timely/contract/designTokens";
import { cn } from "@/app/utils/cn";
import { easeOut } from "@/app/_components/_ui/motion";

/*
 * Completing a task (catalogue item 6): the box fills in 6 frames and the
 * tick draws, then the title's strike grows across in 10 frames. The same
 * control on the task table, Today, the dashboard's Top three and the
 * calendar, so a tick looks the same everywhere.
 */

const FILL_SECONDS = 6 / MOTION.fps;
const STRIKE_SECONDS = 10 / MOTION.fps;

export function TaskCheck({
  checked,
  onToggle,
  label,
  shape = "circle",
  size = 18,
  tone = "success",
  disabled = false,
  stopPropagation = false,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  shape?: "circle" | "square";
  size?: number;
  tone?: "success" | "primary";
  disabled?: boolean;
  /** Inside a clickable row: keep the row's own click from firing. */
  stopPropagation?: boolean;
  className?: string;
}) {
  const border = tone === "primary" ? "border-primary" : "border-success";
  const fill = tone === "primary" ? "bg-primary" : "bg-success";
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) event.stopPropagation();
        onToggle();
      }}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden border transition-colors disabled:cursor-default",
        shape === "circle" ? "rounded-full" : "rounded-md",
        checked ? cn(border, "text-white") : "border-muted-foreground/50 hover:border-primary",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <motion.span
        aria-hidden
        className={cn("absolute inset-0 rounded-[inherit]", fill)}
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ duration: FILL_SECONDS, ease: easeOut }}
      />
      <svg
        viewBox="0 0 24 24"
        className="relative"
        style={{ width: Math.round(size * 0.66), height: Math.round(size * 0.66) }}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <motion.path
          d="M5 12.5l4.2 4.2L19 7.5"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: FILL_SECONDS, ease: easeOut, delay: checked ? FILL_SECONDS * 0.4 : 0 }}
        />
      </svg>
    </motion.button>
  );
}

/** A task title whose strike-through grows across when `done` turns on. */
export function StrikeTitle({
  done,
  className,
  children,
  ...rest
}: { done: boolean; className?: string; children: ReactNode } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      className={cn(
        "relative inline-block min-w-0 max-w-full truncate align-bottom transition-colors",
        done && "text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {children}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-current"
        style={{ originX: 0 }}
        initial={false}
        animate={{ scaleX: done ? 1 : 0 }}
        transition={{ duration: STRIKE_SECONDS, ease: easeOut, delay: done ? FILL_SECONDS : 0 }}
      />
    </span>
  );
}

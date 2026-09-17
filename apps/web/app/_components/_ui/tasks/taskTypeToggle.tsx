"use client";

import { Bell, ListTodo } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/app/utils/cn";
import { springSoft } from "@/app/_components/_ui/motion";

export default function TaskTypeToggle({
  value,
  onChange,
  className,
}: {
  value: "task" | "reminder" | null;
  onChange: (value: "task" | "reminder") => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Item type"
      className={cn("grid grid-cols-2 rounded-lg border border-border bg-muted/40 p-0.5", className)}
    >
      {(["task", "reminder"] as const).map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="task-type-pill"
                transition={springSoft}
                className="absolute inset-0 rounded-md bg-primary shadow-sm"
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {option === "task" ? (
                <ListTodo className="size-3.5" />
              ) : (
                <Bell className="size-3.5" />
              )}
              {option === "task" ? "Work" : "Reminder"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

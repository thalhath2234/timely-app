"use client";

import { Bell, ListTodo } from "lucide-react";
import { cn } from "@/app/utils/cn";

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
      <button
        type="button"
        role="radio"
        aria-checked={value === "task"}
        onClick={() => onChange("task")}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          value === "task"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ListTodo className="size-3.5" />
        Work
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "reminder"}
        onClick={() => onChange("reminder")}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
          value === "reminder"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Bell className="size-3.5" />
        Reminder
      </button>
    </div>
  );
}

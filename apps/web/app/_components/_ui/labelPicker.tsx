"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Label } from "@/app/_types/types";
import { cn } from "@/app/utils/cn";
import { motion } from "motion/react";
import { propertyChipClass } from "@/app/_components/_ui/propertyChip";

type LabelPickerProps = {
  labels: Label[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
  className?: string;
  /** "chip" draws each label as a create form's property chip. */
  variant?: "pill" | "chip";
  /** Shown at the end of the row (the "New label" chip). */
  trailing?: ReactNode;
};

export default function LabelPicker({
  labels,
  selectedIds,
  onChange,
  emptyLabel = "No labels in this workspace. Add some in Settings.",
  className,
  variant = "pill",
  trailing,
}: LabelPickerProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIds, id]);
  };

  if (variant === "chip") {
    return (
      <div className={cn("flex flex-wrap items-start gap-1.5", className)}>
        {labels.map((label) => {
          const active = selected.has(label.id);
          return (
            <button
              key={label.id}
              type="button"
              aria-pressed={active}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggle(label.id);
              }}
              className={propertyChipClass({
                empty: !active,
                className: active ? "bg-transparent hover:bg-transparent hover:brightness-95" : undefined,
              })}
              style={active ? { backgroundColor: `${label.color}24` } : undefined}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
              <span className="truncate">{label.name}</span>
              {active ? <Check aria-hidden /> : null}
            </button>
          );
        })}
        {trailing}
      </div>
    );
  }

  if (labels.length === 0) {
    if (!emptyLabel) return null;
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {labels.map((label) => {
        const active = selected.has(label.id);
        return (
          <motion.button
            key={label.id}
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(label.id);
            }}
            aria-pressed={active}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-transparent text-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            style={
              active
                ? {
                    backgroundColor: `${label.color}33`,
                    borderColor: `${label.color}88`,
                    color: label.color,
                  }
                : undefined
            }
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            {label.name}
            {active ? <span className="ml-0.5 text-[11px] opacity-70">×</span> : null}
          </motion.button>
        );
      })}
    </div>
  );
}

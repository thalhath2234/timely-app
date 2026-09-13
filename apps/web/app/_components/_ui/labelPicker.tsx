"use client";

import { Label } from "@/app/_types/types";
import { cn } from "@/app/utils/cn";

type LabelPickerProps = {
  labels: Label[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
  className?: string;
};

export default function LabelPicker({
  labels,
  selectedIds,
  onChange,
  emptyLabel = "No labels in this workspace. Add some in Settings.",
  className,
}: LabelPickerProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIds, id]);
  };

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
          <button
            key={label.id}
            type="button"
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
          </button>
        );
      })}
    </div>
  );
}

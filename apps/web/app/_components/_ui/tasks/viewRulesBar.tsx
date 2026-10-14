"use client";

import { X } from "lucide-react";
import { describeView, type ViewChip, type ViewVocabulary } from "@timely/contract/viewLanguage";
import type { TaskViewConfig } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import { cn } from "@/app/utils/cn";

/** Chip keys the toolbar and options bar already show as controls. */
function hasControl(chip: ViewChip): boolean {
  return !(chip.key.startsWith("rule:") || chip.key === "match:any" || chip.key === "sort:then" || chip.key === "limit");
}

/**
 * One pill per part of a view [natural-language views]. With `onRemove`,
 * each pill has an x that takes that part off.
 */
export function ViewChips({
  chips,
  onRemove,
  className,
}: {
  chips: ViewChip[];
  onRemove?: (chip: ViewChip) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="What this view shows">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className={cn(
            "inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted text-xs font-medium text-foreground",
            onRemove ? "pl-2.5 pr-1" : "px-2.5",
          )}
        >
          <span className="truncate">{chip.label}</span>
          {onRemove ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(chip);
              }}
              aria-label={`Remove ${chip.label}`}
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The view's rules, second sort and limit as removable chips under the
 * options bar. For a Preview from search it also carries Save as view and
 * Close, and shows every part of the view since nothing is saved yet.
 */
export default function ViewRulesBar({
  view,
  vocab,
  onPatch,
  preview,
}: {
  view: TaskViewConfig | undefined;
  vocab: ViewVocabulary;
  onPatch: (patch: Partial<TaskViewConfig>) => void;
  preview?: { onSave: () => void; onClose: () => void; full: boolean };
}) {
  if (!view) return null;
  const all = describeView(view, vocab);
  const chips = preview ? all : all.filter((chip) => !hasControl(chip));
  if (!preview && chips.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-2",
        preview && "bg-primary/5",
      )}
      data-testid={preview ? "view-preview-bar" : "view-rules-bar"}
    >
      {preview ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Preview</span>
      ) : (
        <span className="text-xs text-muted-foreground">Rules</span>
      )}
      <ViewChips chips={chips} onRemove={(chip) => onPatch(chip.remove)} className="min-w-0 flex-1" />
      {preview ? (
        <div className="ml-auto flex items-center gap-1.5">
          {preview.full ? (
            <span className="text-xs text-muted-foreground">20 views saved; delete one to save this</span>
          ) : null}
          <Button size="sm" variant="ghost" onClick={preview.onClose}>
            Close
          </Button>
          <Button size="sm" variant="primary" onClick={preview.onSave} disabled={preview.full}>
            Save as view
          </Button>
        </div>
      ) : null}
    </div>
  );
}

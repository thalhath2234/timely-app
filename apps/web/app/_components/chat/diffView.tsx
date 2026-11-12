"use client";
import { cn } from "@/app/utils/cn";
import { diffRows } from "./learningView";

/**
 * A unified diff as coloured lines: what a staged change, a skill's history
 * entry or an upstream update would change. Added lines on the success
 * tint, removed ones on the destructive tint, file headers left out.
 */
export default function DiffView({
  diff,
  className,
}: {
  diff: string;
  className?: string;
}) {
  const rows = diffRows(diff).filter((row) => row.kind !== "file");
  if (!rows.length)
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Nothing changes.
      </p>
    );
  return (
    <div
      role="group"
      aria-label="What changes"
      className={cn(
        "max-h-80 overflow-auto rounded-md border border-border bg-muted/40 py-1 font-mono text-xs leading-5",
        className,
      )}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          className={cn(
            "flex min-w-max gap-2 px-2.5",
            row.kind === "add" && "bg-success/10 text-foreground",
            row.kind === "remove" && "bg-destructive/10 text-foreground",
            row.kind === "hunk" && "mt-1 text-muted-foreground first:mt-0",
            row.kind === "context" && "text-muted-foreground",
          )}
        >
          <span aria-hidden className="w-2 shrink-0 select-none">
            {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
          </span>
          <span className="sr-only">
            {row.kind === "add"
              ? "Added: "
              : row.kind === "remove"
                ? "Removed: "
                : ""}
          </span>
          <span className="whitespace-pre">
            {row.kind === "hunk" ? "…" : row.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}

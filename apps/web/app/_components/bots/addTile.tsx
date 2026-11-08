"use client";

import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { StarterId } from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";
import { StarterTiles } from "./starters";

/** The dashed "New bot" tile that ends the board, with the starters under it. */
export function AddTile({
  compact,
  onNew,
  onStarter,
  style,
}: {
  compact?: boolean;
  onNew: () => void;
  onStarter: (id: StarterId) => void;
  style?: CSSProperties;
}) {
  const head = (
    <button
      type="button"
      onClick={onNew}
      className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-4"
    >
      <Plus aria-hidden />
      New bot
    </button>
  );
  const line = (
    <p className="text-xs text-muted-foreground">
      Start from a starter, or a blank editor that needs no AI.
    </p>
  );
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-[12px] border border-dashed border-border-strong p-3.5",
        !compact && "justify-center gap-3.5",
      )}
      style={style}
    >
      {compact ? (
        <>
          {head}
          {line}
        </>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {head}
          {line}
        </div>
      )}
      <StarterTiles compact={compact} onPick={onStarter} />
    </div>
  );
}

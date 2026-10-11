"use client";

import type { CSSProperties } from "react";
import { Check, Sparkles } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";
import { cn } from "@/app/utils/cn";

type Row = { item: string; owner: string | null; cost: number | null; fillOwner?: string; fillCost?: number };

/** Six items; the cells with `fill*` are empty until the assistant proposes a value. */
const ROWS: Row[] = [
  { item: "Domain renewal", owner: "Dana", cost: 18 },
  { item: "Hosting, 12 months", owner: "Dana", cost: 96 },
  { item: "Stock photos", owner: null, cost: null, fillOwner: "Mia", fillCost: 120 },
  { item: "Font licence", owner: null, cost: null, fillOwner: "Mia", fillCost: 240 },
  { item: "Copy editing", owner: null, cost: null, fillOwner: "Sam", fillCost: 300 },
  { item: "Launch ads", owner: null, cost: null, fillOwner: "Sam", fillCost: 180 },
];

/** The empty cells in the order the assistant fills them: row by row, owner then cost. */
const FILLS = ROWS.flatMap((row, r) => (row.owner === null ? [{ r, col: "owner" as const }, { r, col: "cost" as const }] : []));

// Frame k < FILLS.length: cells before k are filled, cell k shimmers.
// Then one frame with everything proposed, one approved, one cleared pause.
const FRAMES = FILLS.length + 3;
const DELAYS = [...FILLS.map(() => 620), 1500, 3200, 900];

const COLS = "minmax(0,1.5fr) minmax(0,0.9fr) 6.5rem";

function money(value: number) {
  return value.toFixed(2);
}

/**
 * "Launch budget": the assistant fills the empty Owner and Cost cells one by
 * one and the SUM row follows. Then the proposal is approved.
 */
export default function BudgetSheet({ className }: { className?: string }) {
  const { ref, frame } = useLoop(FRAMES, DELAYS, FILLS.length + 1);
  const cleared = frame === FRAMES - 1;
  const filled = cleared ? 0 : Math.min(frame, FILLS.length);
  const proposed = !cleared && frame >= FILLS.length;
  const approved = !cleared && frame >= FILLS.length + 1;

  const isFilled = (r: number, col: "owner" | "cost") => FILLS.findIndex((cell) => cell.r === r && cell.col === col) < filled;
  const isShimmer = (r: number, col: "owner" | "cost") => !cleared && FILLS[filled]?.r === r && FILLS[filled]?.col === col;

  const total = ROWS.reduce((sum, row, r) => {
    if (row.cost !== null) return sum + row.cost;
    return isFilled(r, "cost") && row.fillCost ? sum + row.fillCost : sum;
  }, 0);

  return (
    <div ref={ref} className={cn("v4-cell", className)} aria-hidden>
      {/* Sheet title bar, like the app's file header. */}
      <div className="flex h-[var(--v4-row)] items-center justify-between gap-3 border-b border-[var(--v-line-strong)] px-3.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-base leading-none">💰</span>
          Launch budget
        </span>
        <span className="v4-mono text-[0.6875rem] text-[var(--v-faint)]">Website / Sheets</span>
      </div>

      <div className="v4-thead" style={{ "--cols": COLS } as CSSProperties}>
        <span>
          <b>A</b>Item
        </span>
        <span>
          <b>B</b>Owner
        </span>
        <span className="justify-end">
          <b>C</b>Cost
        </span>
      </div>

      {ROWS.map((row, r) => {
        const owner = row.owner ?? (isFilled(r, "owner") ? row.fillOwner : null);
        const cost = row.cost ?? (isFilled(r, "cost") ? row.fillCost : null);
        const proposedOwner = row.owner === null && owner !== null;
        const proposedCost = row.cost === null && cost !== null;
        return (
          <div key={row.item} className="v4-tr" style={{ "--cols": COLS } as CSSProperties}>
            <span className="v4-td text-sm">{row.item}</span>
            <span className={cn("v4-td text-sm", isShimmer(r, "owner") && "v4-selected")}>
              {owner !== null && owner !== undefined ? (
                <span className={cn(proposedOwner && !approved && "text-[var(--v-primary)]")}>{owner}</span>
              ) : isShimmer(r, "owner") ? (
                <span className="v4-shimmer" />
              ) : null}
            </span>
            <span className={cn("v4-td v4-td-num text-sm", isShimmer(r, "cost") && "v4-selected")}>
              {cost !== null && cost !== undefined ? (
                <span className={cn(proposedCost && !approved && "text-[var(--v-primary)]")}>{money(cost)}</span>
              ) : isShimmer(r, "cost") ? (
                <span className="v4-shimmer" />
              ) : null}
            </span>
          </div>
        );
      })}

      <div className="v4-tr border-t border-t-[var(--v-line-strong)] bg-[var(--v-raised)]" style={{ "--cols": COLS } as CSSProperties}>
        <span className="v4-td text-sm font-semibold">Total</span>
        <span className="v4-td v4-td-mono">=SUM(C2:C7)</span>
        <span className="v4-td v4-td-num text-sm font-semibold text-[var(--v-primary)]">{money(total)}</span>
      </div>

      {/* The assistant's proposal, as the app shows it: a card you approve. */}
      <div className="flex min-h-[var(--v4-row)] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--v-line-strong)] px-3.5 py-2">
        <span className="flex items-center gap-2 text-[0.8125rem] text-[var(--v-soft)]">
          <Sparkles className="size-3.5 shrink-0 text-[var(--v-primary)]" />
          {cleared ? (
            <>Fill in the owners and costs</>
          ) : proposed ? (
            <>
              <span className="text-[var(--v-ink)]">{FILLS.length} cells proposed</span>
              <span className="hidden sm:inline">from the brief and last year&apos;s sheet</span>
            </>
          ) : (
            <>
              Filling <span className="v4-mono text-[var(--v-ink)]">{`${FILLS[filled]?.col === "owner" ? "B" : "C"}${FILLS[filled]?.r + 2}`}</span>…
            </>
          )}
        </span>
        <span
          className={cn(
            "v4-cellbtn h-8 text-xs transition-opacity",
            approved ? "v4-cellbtn-ghost" : "v4-cellbtn-primary",
            !proposed && "opacity-0",
          )}
        >
          {approved ? (
            <>
              <Check className="size-3.5 text-[var(--v-primary)]" />
              Approved
            </>
          ) : (
            "Approve"
          )}
        </span>
      </div>
    </div>
  );
}

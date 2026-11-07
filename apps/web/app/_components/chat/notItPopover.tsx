"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { formatMoney, type PreviewCandidate } from "@timely/contract/bots";
import { buttonClass } from "@/app/_components/_ui/button";
import { popoverSurface } from "@/app/_components/_ui/field";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { PopoverView } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";

const FROM: Record<PreviewCandidate["from"], string> = {
  jsonld: "The shop's own price data",
  og: "The page's price tag",
  itemprop: "The page's price tag",
  text: "",
};

/** A candidate's second line: struck out, where it came from, or the one it reads. */
function candidateMeta(candidate: PreviewCandidate, current?: number | null) {
  if (candidate.struck) return "Struck-out price";
  if (current != null && candidate.amount === current)
    return "What it reads now";
  return FROM[candidate.from] || undefined;
}

/**
 * "That's not it" on a proposed bot's reading: the other prices found on the
 * page, each of which asks chat to follow that one instead, then "Something
 * else…" to say it in words. A reading with no other prices (text, a feed)
 * goes straight to the composer.
 */
export default function NotItPopover({
  candidates,
  current,
  disabled,
  onPick,
  onOther,
}: {
  /** The prices found on the page; none for a text or feed reading. */
  candidates: PreviewCandidate[];
  /** The amount it reads now. */
  current?: number | null;
  disabled?: boolean;
  onPick: (candidate: PreviewCandidate) => void;
  onOther: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes this list, not the chat dialog it sits in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={candidates.length ? open : undefined}
        aria-haspopup={candidates.length ? "dialog" : undefined}
        onClick={() => (candidates.length ? setOpen((was) => !was) : onOther())}
        className={buttonClass({ variant: "outline", size: "sm" })}
      >
        <X aria-hidden />
        That’s not it
      </button>
      {open ? (
        <PopoverView>
          <div
            role="dialog"
            aria-label="Which price should it follow?"
            className={cn(
              popoverSurface,
              "absolute bottom-9 right-0 z-40 w-80 max-w-[calc(100vw-2rem)] p-3 text-xs",
            )}
          >
            <GroupLabel
              aside={`${candidates.length} found`}
              className="items-baseline"
            >
              Which price should it follow?
            </GroupLabel>
            <ListGroup>
              {candidates.map((candidate, i) => {
                const meta = candidateMeta(candidate, current);
                return (
                  <ListRow
                    key={`${i}:${candidate.selector}:${candidate.amount}`}
                    label={candidate.label || "Price"}
                    meta={meta}
                    aria-label={`Follow ${candidate.label || "this price"}, ${formatMoney(candidate.amount, candidate.currency)}`}
                    onClick={() => {
                      setOpen(false);
                      onPick(candidate);
                    }}
                  >
                    {meta === "What it reads now" ? (
                      <Check aria-hidden className="size-3.5 text-primary" />
                    ) : null}
                    <span
                      className={cn(
                        "text-[13px] font-medium tabular-nums text-foreground",
                        candidate.struck &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {formatMoney(candidate.amount, candidate.currency)}
                    </span>
                  </ListRow>
                );
              })}
              <ListRow
                label="Something else…"
                onClick={() => {
                  setOpen(false);
                  onOther();
                }}
              />
            </ListGroup>
            <GroupHint>
              None of these? Tell chat which number you mean and it reads the
              page again.
            </GroupHint>
          </div>
        </PopoverView>
      ) : null}
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import type { Chain } from "@timely/contract/bots";
import {
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import { cn } from "@/app/utils/cn";
import { CountPill } from "./countPill";

/**
 * The board's Chains group: one row per chain of Pass to links ("Deals feed
 * → Price check"), with what it passed on today, opening its first bot.
 * `filler` ends a list shorter than Today's in a muted row that takes the
 * rest of the card, so the two cards end level.
 */
export function ChainsGroup({
  chains,
  onOpen,
  filler,
  className,
  style,
}: {
  chains: Chain[];
  onOpen: (id: string) => void;
  filler?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      aria-label="Chains"
      className={cn("flex min-w-0 flex-col", className)}
      style={style}
    >
      <GroupLabel>
        <span className="inline-flex items-center gap-2">
          Chains
          <CountPill>{chains.length}</CountPill>
        </span>
      </GroupLabel>
      <ListGroup className="flex flex-1 flex-col">
        {chains.map((c) => (
          <ListRow
            key={c.ids.join(">")}
            label={c.label}
            onClick={() => onOpen(c.firstBotId)}
          >
            <span className="text-[13px] font-medium tabular-nums text-muted-foreground">
              {c.passedToday} today
            </span>
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </ListRow>
        ))}
        {filler ? (
          <div className="flex-1 px-3.5 text-[13px] leading-10 text-muted-foreground">
            No more chains
          </div>
        ) : null}
      </ListGroup>
    </section>
  );
}

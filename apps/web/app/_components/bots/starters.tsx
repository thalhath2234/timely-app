"use client";

import type { CSSProperties } from "react";
import {
  ChartCandlestick,
  Globe,
  MessageCircle,
  Rss,
  Sunrise,
  TrendingDown,
} from "lucide-react";
import { STARTERS, type Starter, type StarterId } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { cn } from "@/app/utils/cn";
import { Pill } from "./countPill";

const STARTER_ICONS = {
  "trending-down": TrendingDown,
  globe: Globe,
  "chart-candlestick": ChartCandlestick,
  rss: Rss,
  sunrise: Sunrise,
} as const;

export function StarterIcon({
  starter,
  className,
}: {
  starter: Starter;
  className?: string;
}) {
  const Icon = STARTER_ICONS[starter.icon];
  return <Icon aria-hidden className={className} />;
}

/**
 * A starter on the empty page: what it watches and when it tells you, as
 * grouped rows. Use opens the editor filled in; Describe in chat puts its
 * words in the chat. A Later starter cannot be used yet.
 */
export function StarterCard({
  starter,
  onUse,
  onChat,
  style,
}: {
  starter: Starter;
  onUse: (id: StarterId) => void;
  onChat: (text: string) => void;
  style?: CSSProperties;
}) {
  const later = !!starter.later;
  return (
    <article
      className="lift flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
      style={style}
    >
      <div
        className={cn(
          "flex flex-1 flex-col gap-2.5 p-3.5",
          later && "opacity-[0.72]",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-fill text-muted-foreground">
            <StarterIcon starter={starter} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-5 text-foreground">
              {starter.name}
            </p>
            <p className="truncate text-xs leading-4 text-muted-foreground">
              {starter.sub}
            </p>
          </div>
          {later ? <Pill>Later</Pill> : null}
        </div>
        <p className="text-[13px] leading-5 text-foreground">
          “{starter.quote}”
        </p>
        <ListGroup>
          {starter.rows.map(([label, value]) => (
            <ListRow
              key={label}
              label={<span className="text-muted-foreground">{label}</span>}
            >
              <span className="truncate text-[13px] font-medium text-foreground">
                {value}
              </span>
            </ListRow>
          ))}
        </ListGroup>
      </div>
      <div className="flex min-h-11 items-center gap-2 border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate leading-4">
          {later ? "Comes in a later version" : "Opens the editor filled in"}
        </span>
        {/* An icon, so the hint keeps its one line beside Use. */}
        {!later && starter.chatText ? (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Describe in chat"
            title="Describe in chat"
            onClick={() => onChat(starter.chatText ?? "")}
          >
            <MessageCircle />
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={later}
          onClick={() => onUse(starter.id)}
        >
          Use
        </Button>
      </div>
    </article>
  );
}

const laterTag = (
  <span className="ml-1.5 inline-flex h-4 items-center rounded-full bg-muted-foreground/14 px-1.5 align-[1px] text-[10px] font-medium text-muted-foreground">
    Later
  </span>
);

/**
 * The starters in the add tile: five tiles in a row (3 + 2 when the tile is
 * narrow), or `compact` wrapping chips. A starter marked Later is shown but
 * cannot be picked yet.
 */
export function StarterTiles({
  compact,
  onPick,
}: {
  compact?: boolean;
  onPick: (id: StarterId) => void;
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {STARTERS.map((starter) => (
          <button
            key={starter.id}
            type="button"
            disabled={starter.later}
            onClick={() => onPick(starter.id)}
            className={cn(
              "inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5",
              starter.later
                ? "cursor-not-allowed border-dashed border-border text-muted-foreground"
                : "cursor-pointer border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <StarterIcon starter={starter} />
            {starter.name}
            {starter.later ? laterTag : null}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="@container">
      <div className="grid grid-cols-3 gap-2 @[900px]:grid-cols-5">
        {STARTERS.map((starter) => (
          <button
            key={starter.id}
            type="button"
            disabled={starter.later}
            onClick={() => onPick(starter.id)}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-[12px] border p-3 text-left transition-colors",
              starter.later
                ? "cursor-not-allowed border-dashed border-border"
                : "lift cursor-pointer border-border bg-card hover:bg-muted/40",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-fill text-muted-foreground">
              <StarterIcon starter={starter} className="size-4" />
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block whitespace-nowrap text-[13px] font-semibold leading-[18px]",
                  starter.later ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {starter.name}
                {starter.later ? laterTag : null}
              </span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">
                {starter.tileSub}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

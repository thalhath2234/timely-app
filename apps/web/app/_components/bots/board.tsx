"use client";

import { useMemo, type ReactNode } from "react";
import {
  boardColumns,
  boardSections,
  fillSpans,
  type BoardGroup,
  type BotView,
  type GridItem,
  type StarterId,
} from "@timely/contract/bots";
import { GroupLabel } from "@/app/_components/_ui/groupedList";
import { useElementSize } from "@/app/_components/report/charts";
import { useBotIcons } from "@/app/utils/hooks/bots";
import { AddTile } from "./addTile";
import { useBotActions } from "./botActions";
import { BotCard } from "./botCard";
import { botSites } from "./botMark";
import { CountPill } from "./countPill";

const SECTIONS: { id: BoardGroup; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "watching", label: "Watching" },
  { id: "paused", label: "Paused" },
];

/** Columns before the board is measured: the 1440 px layout. */
const FIRST_COLUMNS = 4;

/** A section's heading: its label with the count beside it. */
export function SectionLabel({
  children,
  count,
  attn,
}: {
  children: ReactNode;
  count: number;
  attn?: boolean;
}) {
  return (
    <GroupLabel>
      <span className="inline-flex items-center gap-2">
        {children}
        <CountPill tone={attn ? "attn" : "default"}>{count}</CountPill>
      </span>
    </GroupLabel>
  );
}

/**
 * The board: Needs you (wide cards with what to do), Watching and Paused,
 * then the add tile. Columns follow the board's own width (1, 2, 4 or 6), and
 * every row is filled to its end so no column is left empty. `compact` is
 * the single column of small cards beside an open bot.
 */
export function BotsBoard({
  bots,
  now,
  selectedId,
  compact,
  onOpen,
  onNew,
  onStarter,
}: {
  bots: BotView[];
  now: Date;
  selectedId?: string | null;
  compact?: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onStarter: (id: StarterId) => void;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const cols = compact
    ? 1
    : size.width
      ? boardColumns(size.width)
      : FIRST_COLUMNS;
  const sections = boardSections(bots, now);
  const shown = SECTIONS.filter((s) => sections[s.id].length > 0);
  const sites = useMemo(() => botSites(bots.flatMap((b) => b.watches)), [bots]);
  const icons = useBotIcons(sites).data;
  const actions = useBotActions(onOpen);
  const addTo = shown[shown.length - 1]?.id;

  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-5">
      {shown.map(({ id, label }) => {
        const list = sections[id];
        const items: GridItem[] = list.map(() =>
          id === "needs" && !compact ? "wide" : "card",
        );
        if (id === addTo) items.push("add");
        const spans = fillSpans(items, cols);
        const span = (index: number) =>
          compact
            ? undefined
            : { gridColumn: `span ${spans[index]} / span ${spans[index]}` };
        return (
          <section key={id} aria-label={label} className="min-w-0">
            <SectionLabel count={list.length} attn={id === "needs"}>
              {label}
            </SectionLabel>
            <div
              className={compact ? "flex flex-col gap-2" : "grid gap-3"}
              style={
                compact
                  ? undefined
                  : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
              }
            >
              {list.map((bot, index) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  now={now}
                  variant={
                    compact ? "mini" : id === "needs" ? "wide" : "standard"
                  }
                  stacked={cols === 1}
                  selected={bot.id === selectedId}
                  onOpen={onOpen}
                  icons={icons}
                  actions={actions}
                  style={span(index)}
                />
              ))}
              {id === addTo ? (
                <AddTile
                  compact={compact || spans[list.length] < 3}
                  onNew={onNew}
                  onStarter={onStarter}
                  style={span(list.length)}
                />
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

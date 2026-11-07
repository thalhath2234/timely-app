"use client";

import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import { Bell, Monitor, Plus, ShieldCheck, Smartphone } from "lucide-react";
import {
  boardColumns,
  DEFAULT_BOT_SETTINGS,
  fillSpans,
  STARTERS,
  type BotSettings,
  type GridItem,
  type StarterId,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import {
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";
import { useElementSize } from "@/app/_components/report/charts";
import { useToastStore } from "@/app/_store/toastStore";
import { useBotDefaults, useSetBotDefaults } from "@/app/utils/hooks/bots";
import { cn } from "@/app/utils/cn";
import { StarterCard } from "./starters";

/** Loaded only on the empty page, as EmptyState loads it: Remotion stays out of the board. */
const LoopPlayer = dynamic(() => import("@/app/_components/film/loopPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-[8/5] w-full bg-fill" />,
});

const FACTS = [
  {
    icon: Monitor,
    title: "Runs while Timely is open",
    sub: "Checks run on this PC, even from the tray, and catch up when you’re back.",
  },
  {
    icon: Bell,
    title: "Quiet by default",
    sub: "A rule tells you once when it becomes true. At most 3 alerts a day.",
  },
  {
    icon: ShieldCheck,
    title: "Reads, never acts",
    sub: "It reads pages, feeds and prices. It never buys, posts or deletes. Bots made by outside apps, like Claude Code, start paused until you turn them on.",
  },
];

// The two starters most people want sit beside the hero; the rest below.
const FIRST_ROW = STARTERS.filter(
  (s) => s.id === "price_drop" || s.id === "page_changed",
);
const MORE = STARTERS.filter((s) => !FIRST_ROW.includes(s));

const span = (n: number | undefined) =>
  n ? { gridColumn: `span ${n} / span ${n}` } : undefined;

/** "Alerts for new bots": where a bot made from now on tells the person. */
function AlertDefaultsCard({ style }: { style?: CSSProperties }) {
  const defaults = useBotDefaults();
  const save = useSetBotDefaults();
  const current: BotSettings =
    save.isPending && save.variables
      ? save.variables
      : (defaults.data ?? DEFAULT_BOT_SETTINGS);
  const set = (patch: Partial<BotSettings>) =>
    save.mutate(
      { ...current, ...patch },
      { onError: (error) => useToastStore.getState().show(error.message) },
    );
  // Each save sends the whole object, so the switches wait for the stored
  // values: a save built on the fallback would overwrite them.
  const disabled = !defaults.data;
  return (
    <article
      className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
      style={style}
    >
      <div className="px-3.5 pb-1 pt-3.5">
        <p className="text-sm font-semibold leading-5 text-foreground">
          Alerts for new bots
        </p>
        <p className="text-xs leading-4 text-muted-foreground">
          Where a new bot tells you. Change any bot later.
        </p>
      </div>
      {defaults.isError && !defaults.data ? (
        <LoadErrorBanner
          what="where new bots alert"
          error={defaults.error}
          hasCopy={false}
          onRetry={() => void defaults.refetch()}
          retrying={defaults.isFetching}
          className="mx-3.5 mb-3.5 mt-2"
        />
      ) : (
        <ListGroup className="mx-3.5 mb-3.5 mt-2">
          <ListRow
            label="Desktop"
            icon={
              <Monitor
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            }
          >
            <ListSwitch
              label="Desktop alerts for new bots"
              checked={current.desktop}
              disabled={disabled}
              onChange={(desktop) => set({ desktop })}
            />
          </ListRow>
          <ListRow
            label="Phone"
            icon={
              <Smartphone
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            }
          >
            <ListSwitch
              label="Phone alerts for new bots"
              checked={current.phone}
              disabled={disabled}
              onChange={(phone) => set({ phone })}
            />
          </ListRow>
          <ListRow
            label="Urgent"
            meta="Rings through quiet hours"
            icon={
              <Bell
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            }
          >
            <ListSwitch
              label="New bots' alerts are urgent"
              checked={current.urgent}
              disabled={disabled}
              onChange={(urgent) => set({ urgent })}
            />
          </ListRow>
        </ListGroup>
      )}
    </article>
  );
}

/**
 * The Bots page before the first bot: what a bot does beside a film loop and
 * New bot, the starters, where new bots alert, and three facts about how bots
 * behave. Laid out on the board's own columns.
 */
export function BotsEmpty({
  onNew,
  onStarter,
  onChat,
}: {
  onNew: () => void;
  onStarter: (id: StarterId) => void;
  onChat: (text: string) => void;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const cols = size.width ? boardColumns(size.width) : 4;
  const grid = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  const firstSpans = fillSpans(["wide", "card", "card"] as GridItem[], cols);
  const moreSpans = fillSpans(
    ["card", "card", "card", "card"] as GridItem[],
    cols,
  );
  const stacked = firstSpans[0] < 2 || size.width < 900;

  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-5">
      <div className="grid gap-3" style={grid}>
        <article
          className={cn(
            "flex min-w-0 gap-5 rounded-[12px] border border-border bg-card p-4",
            stacked ? "flex-col" : "flex-row items-center",
          )}
          style={span(firstSpans[0])}
        >
          <div
            className={cn(
              "shrink-0 overflow-hidden rounded-[10px] bg-fill",
              stacked ? "w-full" : "w-[360px]",
            )}
          >
            <LoopPlayer id="capture" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-3.5">
            <h2 className="text-lg font-semibold leading-6 tracking-[-0.01em] text-foreground">
              Let a bot keep an eye on it
            </h2>
            <p className="text-sm leading-[21px] text-muted-foreground">
              A bot checks a page, a feed or a price on its own schedule and
              tells you only when something changed.
            </p>
            <Button leading={<Plus />} onClick={onNew}>
              New bot
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens a blank editor. It works without any AI set up.
            </p>
          </div>
        </article>
        {FIRST_ROW.map((s, index) => (
          <StarterCard
            key={s.id}
            starter={s}
            onUse={onStarter}
            onChat={onChat}
            style={span(firstSpans[index + 1])}
          />
        ))}
      </div>

      <section aria-label="More starters" className="min-w-0">
        <GroupLabel aside="Each opens the editor with the words filled in">
          More starters
        </GroupLabel>
        <div className="grid gap-3" style={grid}>
          {MORE.map((s, index) => (
            <StarterCard
              key={s.id}
              starter={s}
              onUse={onStarter}
              onChat={onChat}
              style={span(moreSpans[index])}
            />
          ))}
          <AlertDefaultsCard style={span(moreSpans[3])} />
        </div>
      </section>

      <section aria-label="How bots behave" className="min-w-0">
        <GroupLabel>How bots behave</GroupLabel>
        <div
          className={cn(
            "grid gap-3",
            cols >= 4 ? "grid-cols-3" : "grid-cols-1",
          )}
        >
          {FACTS.map(({ icon: Icon, title, sub }) => (
            <div
              key={title}
              className="flex gap-2.5 rounded-[12px] border border-border bg-card p-4"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[10px] bg-fill text-muted-foreground">
                <Icon aria-hidden className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground">
                  {title}
                </p>
                <p className="text-xs leading-[18px] text-muted-foreground">
                  {sub}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

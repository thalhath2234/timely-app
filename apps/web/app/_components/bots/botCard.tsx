"use client";

import type { CSSProperties, ReactNode } from "react";
import { Play } from "lucide-react";
import {
  cardSub,
  cardValue,
  captionLine,
  feedSources,
  footerRight,
  formatMoney,
  isPriceReading,
  lineOf,
  miniSub,
  miniValue,
  needsReason,
  primaryWatch,
  valueLine,
  watchCurrency,
  type BotView,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { ChangeTint, useChangeKey } from "@/app/_components/_ui/dataMotion";
import { cn } from "@/app/utils/cn";
import type { useBotActions } from "./botActions";
import { BotMark, type SiteIcons } from "./botMark";
import { CheckStrip } from "./checkStrip";
import { HealthLine } from "./healthLine";
import { NeedsAction } from "./needsAction";
import { Sparkline } from "./sparkline";

export type BotCardVariant = "standard" | "wide" | "mini" | "preview";

/** "+2.4% today · $1,588 to go" with the change tinted by its sign. */
function Delta({ text }: { text: string }) {
  const m = /^([+−]\d[\d.]*%)(.*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span
        className={
          m[1].startsWith("+") ? "text-success-text" : "text-destructive"
        }
      >
        {m[1]}
      </span>
      {m[2]}
    </>
  );
}

/** The card's name; it opens the bot, and its hit area covers the whole card. */
function Name({
  bot,
  onOpen,
  wrap,
}: {
  bot: BotView;
  onOpen?: () => void;
  wrap?: boolean;
}) {
  const text = cn(
    "block text-left text-sm font-semibold leading-5 text-foreground",
    wrap ? "line-clamp-2" : "truncate",
  );
  if (!onOpen) return <span className={text}>{bot.name}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        text,
        "w-full cursor-pointer outline-none before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] focus-visible:before:ring-2 focus-visible:before:ring-ring/40",
      )}
    >
      {bot.name}
    </button>
  );
}

function Top({
  bot,
  icons,
  onOpen,
  sub,
  trailing,
}: {
  bot: BotView;
  icons: SiteIcons;
  onOpen?: () => void;
  sub: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 pt-3.5">
      <BotMark watches={bot.watches} kind={bot.kind} icons={icons} />
      <div className="min-w-0 flex-1">
        <Name bot={bot} onOpen={onOpen} wrap={!!trailing} />
        <p className="truncate text-xs leading-4 text-muted-foreground">
          {sub}
        </p>
      </div>
      {trailing}
    </div>
  );
}

/** The value, the line under it, and the price line or row of checks. */
function Middle({ bot, now }: { bot: BotView; now: Date }) {
  const value = cardValue(bot);
  const caption = captionLine(bot, now);
  const w = primaryWatch(bot);
  const changeKey = useChangeKey(value.text);
  // A caption ("Last good read, 3 h ago") already says what the value is.
  const under = caption
    ? null
    : w?.kind === "feed"
      ? feedSources(bot)
      : valueLine(bot);
  const spark =
    w && isPriceReading(w) && (w.spark?.length ?? 0) >= 2 ? w.spark : null;
  let right: ReactNode;
  if (w && spark) {
    const cur = watchCurrency(w);
    const closes = spark.map(([, v]) => v);
    right = (
      <Sparkline
        points={spark}
        threshold={lineOf(w)}
        summary={`Last 30 days: from ${formatMoney(closes[0], cur)} to ${formatMoney(closes[closes.length - 1], cur)}, low ${formatMoney(Math.min(...closes), cur)}`}
      />
    );
  } else {
    right = <CheckStrip marks={bot.strip} count={16} />;
  }
  return (
    <div className="flex min-h-[76px] items-end justify-between gap-3 px-3.5 pb-3.5 pt-3">
      <ChangeTint changeKey={changeKey} />
      <div className="min-w-0 flex-1">
        {caption ? (
          <p className="mb-0.5 truncate text-xs tabular-nums text-muted-foreground">
            {caption}
          </p>
        ) : null}
        {value.kind === "number" ? (
          <p className="whitespace-nowrap text-2xl font-semibold leading-[30px] tracking-[-0.02em] tabular-nums text-foreground">
            {value.text}
            {value.unit ? (
              <span className="ml-1.5 text-sm font-medium tracking-normal text-muted-foreground">
                {value.unit}
              </span>
            ) : null}
          </p>
        ) : (
          <p
            className={cn(
              "line-clamp-2 text-[15px] font-medium leading-[22px]",
              value.tone === "destructive"
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            {value.text}
          </p>
        )}
        {under ? (
          <p className="line-clamp-2 text-xs tabular-nums text-muted-foreground">
            <Delta text={under} />
          </p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

function Footer({
  bot,
  now,
  actions,
  interactive,
}: {
  bot: BotView;
  now: Date;
  actions: Actions;
  interactive: boolean;
}) {
  const right = footerRight(bot, now);
  const personPaused = bot.status === "paused" && !needsReason(bot, now);
  return (
    <div className="mt-auto flex min-h-10 items-center justify-between gap-2 border-t border-border px-3.5 py-1.5 text-xs tabular-nums text-muted-foreground">
      {/* The health line is what the card is for: the right side gives way first. */}
      <HealthLine bot={bot} now={now} className="max-w-full shrink-0" />
      {personPaused && interactive ? (
        <Button
          variant="outline"
          size="sm"
          leading={<Play />}
          loading={actions.busy(bot) === "resume"}
          className="relative z-[1]"
          onClick={() => actions.act(bot, "resume")}
        >
          Resume
        </Button>
      ) : right ? (
        <span className="min-w-0 truncate whitespace-nowrap">{right}</span>
      ) : null}
    </div>
  );
}

type Actions = ReturnType<typeof useBotActions>;

/**
 * A bot on the board. `standard` is a Watching or Paused card; `wide` a
 * Needs-you card with what to do on its right half (`stacked` puts it below
 * on a one-column board); `mini` the compact column beside an open bot;
 * `preview` a card that does nothing (a new bot's "On your board").
 */
export function BotCard({
  bot,
  now,
  variant = "standard",
  selected,
  onOpen,
  icons,
  actions,
  stacked,
  style,
}: {
  bot: BotView;
  now: Date;
  variant?: BotCardVariant;
  selected?: boolean;
  onOpen?: (id: string) => void;
  icons?: SiteIcons;
  actions: Actions;
  stacked?: boolean;
  style?: CSSProperties;
}) {
  const reason = needsReason(bot, now);
  const interactive = variant !== "preview";
  const open = interactive && onOpen ? () => onOpen(bot.id) : undefined;
  const tint = reason
    ? reason === "new_alert" || reason === "waiting_ok"
      ? "border-warning/45"
      : "border-destructive/40"
    : "border-border";
  const shell = cn(
    // An open "Why not?" popover lifts its card over the next ones.
    "relative flex min-w-0 rounded-[12px] border bg-card has-[[role=dialog]]:z-30",
    interactive && "lift",
    selected ? "border-primary ring-1 ring-primary" : tint,
  );

  if (variant === "mini") {
    const mv = miniValue(bot, now);
    return (
      <article
        aria-current={selected || undefined}
        className={cn(shell, "flex-col")}
        style={style}
      >
        <Top
          bot={bot}
          icons={icons}
          onOpen={open}
          sub={miniSub(bot, now)}
          trailing={
            mv ? (
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold leading-5 tabular-nums text-foreground">
                  {mv.text}
                </p>
                {mv.change ? (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    <Delta text={mv.change} />
                  </p>
                ) : null}
              </div>
            ) : undefined
          }
        />
        <div className="flex min-h-11 items-center justify-between gap-2 px-3.5 pb-3 pt-2 text-xs text-muted-foreground">
          <HealthLine bot={bot} now={now} mini />
          {reason ? (
            <NeedsAction bot={bot} now={now} compact actions={actions} />
          ) : (
            <CheckStrip marks={bot.strip} count={12} />
          )}
        </div>
      </article>
    );
  }

  const body = (
    <>
      <Top bot={bot} icons={icons} onOpen={open} sub={cardSub(bot)} />
      <Middle bot={bot} now={now} />
      <Footer bot={bot} now={now} actions={actions} interactive={interactive} />
    </>
  );

  if (variant === "wide" && reason) {
    return (
      <article
        aria-current={selected || undefined}
        className={cn(shell, stacked ? "flex-col" : "flex-row")}
        style={style}
      >
        <div
          className={cn(
            "flex min-w-0 flex-col border-border",
            stacked ? "border-b" : "w-[46%] shrink-0 border-r",
          )}
        >
          {body}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3.5">
          <NeedsAction bot={bot} now={now} actions={actions} />
        </div>
      </article>
    );
  }

  return (
    <article
      aria-current={selected || undefined}
      className={cn(shell, "flex-col")}
      style={style}
    >
      {body}
    </article>
  );
}

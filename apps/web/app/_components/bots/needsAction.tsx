"use client";

import {
  Eye,
  ExternalLink,
  KeyRound,
  Pencil,
  Play,
  Plug,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  agoLabel,
  alertLink,
  defaultMinutes,
  fixButtons,
  fixCopy,
  intervalLabel,
  needsReason,
  primaryWatch,
  tellLine,
  watchTitle,
  type AlertBrief,
  type BotView,
  type FixButton,
} from "@timely/contract/bots";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { AiAlertLine } from "./aiAlertLine";
import { AlertFeedback } from "./alertFeedback";
import type { useBotActions } from "./botActions";
import { Pill } from "./countPill";
import { StrikeMeter } from "./strikeMeter";

type Actions = ReturnType<typeof useBotActions>;

const eyebrow =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/**
 * An alert as a headline and a line under it. A feed alert ("3 new items")
 * leads with its first item; a price or words alert with what happened.
 * `toPost` says the card's link opens that item rather than the feed.
 */
export function alertHeadline(
  alert: Pick<AlertBrief, "title" | "body">,
  botName: string,
  toPost: boolean,
): { title: string; meta: string } {
  const prefix = `${botName}: `;
  const what = alert.title.startsWith(prefix)
    ? alert.title.slice(prefix.length)
    : alert.title;
  const body = alert.body.replace(/ \(\+\d+ more\)$/, "");
  if (/^\d+ new items?$/.test(what) && body) {
    const first = body.replace(/ and \d+ more$/, "");
    return {
      title: first,
      meta: toPost ? `${what} · links to the post` : what,
    };
  }
  return { title: what.charAt(0).toUpperCase() + what.slice(1), meta: body };
}

/** "It would read flipkart.com every 6 hours and tell you when the price is below ₹90,000." */
function waitingLine(bot: BotView): string {
  const w = primaryWatch(bot);
  if (!w) return "Bots made by outside apps start paused.";
  const where = w.kind === "price" ? watchTitle(w) : w.site || watchTitle(w);
  const every = intervalLabel(
    bot.intervalMinutes || defaultMinutes(bot.watches),
  ).replace(/^1 /, "");
  const rule = w.rules[0];
  const tell = rule ? ` and tell you ${tellLine(rule, w)}` : "";
  return `Bots made by outside apps start paused. It would read ${where} every ${every}${tell}.`;
}

function fixIcon(button: FixButton) {
  switch (button.action) {
    case "check_now":
      return <RefreshCw />;
    case "resume":
    case "turn_on":
      return <Play />;
    case "add_key":
      return <KeyRound />;
    case "edit":
    case "edit_url":
      return <Pencil />;
  }
  return <Wrench />;
}

/** The address or selector the fix is about, in mono. */
function fixQuote(bot: BotView): string | null {
  const w = primaryWatch(bot);
  if (!w || w.kind === "price") return null;
  const partRead = w.read === "selector" || w.read === "selector_price";
  if (partRead && w.selector && bot.health.code !== "not_found")
    return w.selector;
  return w.url.replace(/^https?:\/\/(www\.)?/, "") || null;
}

/**
 * The right half of a wide "Needs you" card, or (`compact`) the one action
 * on a compact card: rate a new alert, fix a broken bot, or turn on a bot an
 * outside app made.
 */
export function NeedsAction({
  bot,
  now,
  compact,
  actions,
}: {
  bot: BotView;
  now: Date;
  compact?: boolean;
  actions: Actions;
}) {
  const reason = needsReason(bot, now);
  const busy = actions.busy(bot);
  if (!reason) return null;

  if (reason === "new_alert" && bot.latestAlert) {
    const alert = bot.latestAlert;
    if (compact)
      return (
        <AlertFeedback botId={bot.id} alert={alert} size="icon" align="end" />
      );
    const link = alertLink(bot, alert);
    const { title, meta } = alertHeadline(alert, bot.name, !!link?.post);
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className={eyebrow}>
            New alert · {agoLabel(alert.createdAt, now)}
          </span>
          <Pill tone="primary">Was it worth it?</Pill>
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold text-foreground">
            {title}
          </p>
          {meta ? (
            <p className="mt-0.5 line-clamp-2 text-xs tabular-nums text-muted-foreground">
              {meta}
            </p>
          ) : null}
          <AiAlertLine alert={alert} variant="compact" className="mt-0.5" />
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <AlertFeedback botId={bot.id} alert={alert} />
          {link ? (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "relative z-[1] ml-auto",
              })}
            >
              <ExternalLink />
              {link.label}
            </a>
          ) : null}
        </div>
      </>
    );
  }

  if (reason === "waiting_ok") {
    const turnOn = (
      <Button
        size="sm"
        leading={<Play />}
        loading={busy === "resume"}
        className="relative z-[1]"
        onClick={() => actions.act(bot, "turn_on")}
      >
        Turn on
      </Button>
    );
    if (compact) return turnOn;
    const client = bot.originClient || "an outside app";
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className={eyebrow}>Waiting for your OK</span>
          <Pill tone="warning" className="min-w-0">
            <Plug />
            <span className="truncate">From {client}</span>
          </Pill>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {client.charAt(0).toUpperCase() + client.slice(1)} made this bot for
            you
          </p>
          <p className="mt-0.5 line-clamp-3 text-xs tabular-nums text-muted-foreground">
            {waitingLine(bot)}
          </p>
        </div>
        {/* One row: on a narrow card Delete keeps only its icon. */}
        <div className="@container mt-auto flex items-center gap-2">
          {turnOn}
          <Button
            variant="outline"
            size="sm"
            leading={<Eye />}
            className="relative z-[1]"
            onClick={() => actions.act(bot, "edit")}
          >
            Look it over
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leading={<Trash2 />}
            aria-label="Delete"
            className="relative z-[1] ml-auto"
            onClick={() => actions.askDelete(bot)}
          >
            <span className="hidden @[320px]:inline">Delete</span>
          </Button>
        </div>
      </>
    );
  }

  // broken, needs_key, stopped
  const { primary, secondary } = fixButtons(bot);
  const pending = (b: FixButton) =>
    (busy === "check_now" && b.action === "check_now") ||
    (busy === "resume" && (b.action === "resume" || b.action === "turn_on"));
  if (compact) {
    return (
      <Button
        size="sm"
        leading={<Wrench />}
        loading={pending(primary)}
        title={primary.label}
        className="relative z-[1]"
        onClick={() => actions.act(bot, primary.action)}
      >
        Fix
      </Button>
    );
  }
  const copy = fixCopy(bot);
  const quote = fixQuote(bot);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={eyebrow}>{copy.eyebrow}</span>
        <StrikeMeter strikes={bot.strikes} />
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold text-destructive">
          {copy.title}
        </p>
        <p className="mt-0.5 line-clamp-3 text-xs tabular-nums text-muted-foreground">
          {copy.meta}
        </p>
      </div>
      {quote ? (
        <p
          className="truncate rounded-[10px] bg-fill px-2 py-1.5 font-mono text-xs text-foreground"
          title={quote}
        >
          {quote}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {[primary, secondary].map((b, index) => (
          <Button
            key={`${index}-${b.action}`}
            variant={index === 0 ? "primary" : "outline"}
            size="sm"
            leading={fixIcon(b)}
            loading={pending(b)}
            className="relative z-[1]"
            onClick={() => actions.act(bot, b.action)}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </>
  );
}

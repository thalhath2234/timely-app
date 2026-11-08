import {
  healthLine,
  miniHealth,
  needsReason,
  type BotView,
  type HealthTone,
} from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";

const DOT: Record<HealthTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  off: "bg-muted-foreground/60",
  primary: "bg-primary",
};

/**
 * A card's health: a 6 px tone dot, the word in the foreground and the time
 * muted ("Working · 12 min ago", "Snoozed until Mon 09:00"). `mini` is the
 * compact card's form, which says what the bot needs ("Can’t read the page ·
 * 3 of 5", "Was it worth it?").
 */
export function HealthLine({
  bot,
  now,
  mini,
  allPaused,
  className,
}: {
  bot: BotView;
  now: Date;
  mini?: boolean;
  /** Pause all is on: a bot that would run says "All bots paused". */
  allPaused?: boolean;
  className?: string;
}) {
  const h = healthLine(bot, now, undefined, { allPaused });
  let word = h.word;
  let rest = h.time
    ? h.time.startsWith("until ")
      ? ` ${h.time}`
      : ` · ${h.time}`
    : "";
  let tone = h.tone;
  if (mini) {
    const line = miniHealth(bot, now, undefined, { allPaused });
    const cut = line.indexOf(" · ");
    word = cut < 0 ? line : line.slice(0, cut);
    rest = cut < 0 ? "" : line.slice(cut);
    if (word.startsWith("Snoozed until ")) {
      rest = word.slice("Snoozed".length) + rest;
      word = "Snoozed";
    }
    if (needsReason(bot, now) === "new_alert") tone = "warn";
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <i
        aria-hidden
        className={cn("block size-1.5 shrink-0 rounded-full", DOT[tone])}
      />
      <span className="truncate tabular-nums">
        <span className="font-medium text-foreground">{word}</span>
        {rest}
      </span>
    </span>
  );
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  agoLabel,
  answerMarkWatch,
  answerTone,
  answerWatchMeta,
  clockLabel,
  type BotAnswer,
  type HealthTone,
} from "@timely/contract/bots";
import { buttonClass } from "@/app/_components/_ui/button";
import {
  ListGroup,
  ListRow,
  ListSubLabel,
} from "@/app/_components/_ui/groupedList";
import { BotMark, botSites } from "@/app/_components/bots/botMark";
import { cn } from "@/app/utils/cn";
import { useBotIcons } from "@/app/utils/hooks/bots";

const DOT: Record<HealthTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  off: "bg-muted-foreground/60",
  primary: "bg-primary",
};

/** How many findings an answer card lists. */
const FINDINGS = 3;

/**
 * A tagged bot's answer under the reply written from it: the bot, how fresh
 * its reading is, what each watch reads now, what it found this week, and a
 * way to open it. It only shows; nothing on it changes the bot.
 */
export default function BotAnswerCard({ answer }: { answer: BotAnswer }) {
  const now = useMemo(() => new Date(), []);
  const marks = answer.watches.map(answerMarkWatch);
  const icons = useBotIcons(botSites(marks)).data;
  const tone = answerTone(answer);
  const broken = tone === "bad" && answer.bot.health.line;
  const findings = answer.findings.slice(0, FINDINGS);
  const next =
    answer.bot.status === "active" &&
    answer.nextCheckAt &&
    Date.parse(answer.nextCheckAt) > now.getTime()
      ? `Next check ${clockLabel(answer.nextCheckAt, now)}`
      : "";
  return (
    <section aria-label={`${answer.bot.name} answers`} className="mt-3">
      <ListGroup>
        <div className="flex items-center gap-3 px-3.5 py-3">
          <BotMark watches={marks} size={32} icons={icons} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {answer.bot.name}
            </p>
            <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
              <i
                aria-hidden
                className={cn(
                  "mt-[5px] block size-1.5 shrink-0 rounded-full",
                  DOT[tone],
                )}
              />
              <span className="min-w-0 tabular-nums">
                {answer.freshLine}
                {answer.alertsToday > 0
                  ? ` · ${answer.alertsToday} ${answer.alertsToday === 1 ? "alert" : "alerts"} today`
                  : ""}
              </span>
            </p>
          </div>
        </div>
        {broken ? (
          <p className="px-3.5 py-2 text-xs font-medium text-destructive">
            {answer.bot.health.line}
          </p>
        ) : null}
        {answer.watches.map((w, i) => (
          <ListRow
            key={w.id || i}
            label={w.title}
            meta={answerWatchMeta(w) || undefined}
            icon={
              answer.watches.length > 1 ? (
                <BotMark
                  watches={[marks[i]]}
                  size={24}
                  badge={false}
                  icons={icons}
                />
              ) : undefined
            }
          >
            <span className="truncate text-[13px] font-semibold tabular-nums text-foreground">
              {w.summary || "Nothing read yet"}
            </span>
          </ListRow>
        ))}
        {findings.length ? <ListSubLabel>Found this week</ListSubLabel> : null}
        {findings.map((f) => (
          <ListRow key={f.id} label={f.title} meta={f.why || undefined}>
            <span className="text-xs tabular-nums text-muted-foreground">
              {agoLabel(f.createdAt, now)}
            </span>
          </ListRow>
        ))}
        <div className="flex min-h-10 items-center justify-between gap-2 px-3.5 py-1.5">
          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {next}
          </span>
          <Link
            href={`/bots?bot=${encodeURIComponent(answer.bot.id)}`}
            className={buttonClass({ variant: "ghost", size: "sm" })}
            aria-label={`Open ${answer.bot.name}`}
          >
            Open bot
            <ArrowUpRight aria-hidden />
          </Link>
        </div>
      </ListGroup>
    </section>
  );
}

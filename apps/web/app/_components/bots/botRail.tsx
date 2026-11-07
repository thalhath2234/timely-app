"use client";

import { useState } from "react";
import { ExternalLink, Eye } from "lucide-react";
import {
  BOT_LIMITS,
  DEFAULT_BRIEF_TIME,
  agoLabel,
  alertMeta,
  checkOutcomeLabel,
  clockLabel,
  formatMoney,
  isPriceReading,
  limitRows,
  lineOf,
  previewCard,
  priceSeries,
  priceStats,
  rearmMeta,
  shortDate,
  signedPct,
  valueLine,
  watchCurrency,
  watchTitle,
  type AlertView,
  type BotDetail,
  type BotInput,
  type PreviewResult,
  type Rearm,
  type WatchView,
} from "@timely/contract/bots";
import {
  RailEmpty,
  RailRow,
  RailRows,
  RailSection,
} from "@/app/_components/_ui/pageWithRail";
import Button from "@/app/_components/_ui/button";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { cn } from "@/app/utils/cn";
import { useBotPreview } from "@/app/utils/hooks/bots";
import { AiAlertLine } from "./aiAlertLine";
import { AlertFeedback } from "./alertFeedback";
import { useBotActions } from "./botActions";
import { BotCard } from "./botCard";
import { BotMark } from "./botMark";
import { CheckStrip } from "./checkStrip";
import { HowItCame } from "./howItCame";
import { alertHeadline } from "./needsAction";
import { PriceChart } from "./priceChart";

/** "18:12". */
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

const webAddress = (url: string) => /^https?:\/\//i.test(url);

/** A small picker over two or more watches of one kind, by site or symbol. */
function WatchPicker({
  watches,
  value,
  onChange,
}: {
  watches: WatchView[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (watches.length < 2) return null;
  return (
    <SegmentedControl
      size="sm"
      aria-label="Which watch"
      value={value}
      onChange={onChange}
      className="mb-3 max-w-full overflow-x-auto"
      options={watches.map((w) => ({
        value: w.id,
        label: w.kind === "price" ? w.symbol : w.site || watchTitle(w),
      }))}
    />
  );
}

/** Price, as drawn: now, the line it watches, 30 days of closes, the low and the change. */
function PriceSection({
  detail,
  watches,
}: {
  detail: BotDetail;
  watches: WatchView[];
}) {
  const [picked, setPicked] = useState(watches[0].id);
  const w = watches.find((x) => x.id === picked) ?? watches[0];
  const currency = watchCurrency(w);
  const series = priceSeries(detail.prices, w.id);
  // The newest reading after the last daily close is "now".
  if (w.value != null && w.lastReadingAt) {
    const at = Math.floor(Date.parse(w.lastReadingAt) / 1000);
    if (!series.length || at > series[series.length - 1][0])
      series.push([at, w.value]);
  }
  const stats = priceStats(detail.prices, w.id);
  const line = lineOf(w);
  const under = valueLine({ ...detail, watches: [w] });
  const rule = w.rules.find((r) => r.kind === "below" || r.kind === "above");
  const good =
    stats?.changePct != null && rule
      ? rule.kind === "below"
        ? stats.changePct < 0
        : stats.changePct > 0
      : false;
  return (
    <RailSection title="Price" meta="Last 30 days">
      <WatchPicker watches={watches} value={w.id} onChange={setPicked} />
      <div className="min-w-0">
        <p className="text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">
          {w.value != null ? formatMoney(w.value, currency) : "—"}
        </p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {w.value != null
            ? `Now${under ? ` · ${under}` : ""}`
            : "Not read yet"}
        </p>
      </div>
      <div className="mt-3.5">
        <PriceChart points={series} threshold={line} currency={currency} />
      </div>
      {stats ? (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3.5">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold tabular-nums text-foreground">
              {formatMoney(stats.low, currency)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              30-day low, {stats.lowDay}
            </p>
          </div>
          {stats.changePct != null ? (
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[17px] font-semibold tabular-nums",
                  good ? "text-success-text" : "text-foreground",
                )}
              >
                {signedPct(stats.changePct)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                since {stats.since}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </RailSection>
  );
}

/** Latest reading of a page or feed: the part it reads, or the newest posts. */
function ReadingSection({ watches, now }: { watches: WatchView[]; now: Date }) {
  const [picked, setPicked] = useState(watches[0].id);
  const w = watches.find((x) => x.id === picked) ?? watches[0];
  const items = w.items ?? (w.latestItem ? [w.latestItem] : []);
  return (
    <RailSection
      title="Latest reading"
      meta={w.lastReadingAt ? agoLabel(w.lastReadingAt, now) : "Not read yet"}
    >
      <WatchPicker watches={watches} value={w.id} onChange={setPicked} />
      {w.kind === "feed" ? (
        items.length ? (
          <RailRows>
            {items.slice(0, 5).map((item, i) => (
              <li
                key={`${item.url}-${i}`}
                className="flex min-w-0 items-center gap-2 border-t border-border py-2 first:border-t-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">
                    {item.title || "Untitled post"}
                  </span>
                  {item.publishedAt ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {shortDate(item.publishedAt)}
                    </span>
                  ) : null}
                </span>
                {webAddress(item.url) ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${item.title || "the post"}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </RailRows>
        ) : (
          <RailEmpty>No posts read yet.</RailEmpty>
        )
      ) : w.excerpt || w.summary ? (
        <>
          <p className="rounded-[10px] bg-fill px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
            {w.excerpt || w.summary}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {w.lastChangedAt
              ? `Last changed ${shortDate(w.lastChangedAt)}`
              : "No change seen yet"}
          </p>
        </>
      ) : (
        <RailEmpty>Nothing read yet.</RailEmpty>
      )}
    </RailSection>
  );
}

/**
 * A brief's sends of the last `days` days, from its recent alerts: the
 * week and month counts on the bot hold alerts only. A brief sends
 * about one a day, so a week fits in the rows the page carries.
 */
function briefsSent(detail: BotDetail, now: Date, days: number): number {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return (detail.alerts ?? []).filter(
    (a) => a.kind === "brief" && Date.parse(a.createdAt) >= since,
  ).length;
}

function ChecksSection({ detail, now }: { detail: BotDetail; now: Date }) {
  const last = detail.checks?.[0];
  const brief = detail.kind === "brief";
  return (
    <RailSection title="Checks" meta="This week">
      <RailRows>
        <RailRow
          label="Last check"
          meta={
            last
              ? `${checkOutcomeLabel(last.outcome)} · ${timeOf(last.startedAt)}`
              : undefined
          }
          value={
            detail.lastCheckAt ? agoLabel(detail.lastCheckAt, now) : "Not yet"
          }
        />
        <RailRow
          label={brief ? "Next brief" : "Next check"}
          value={
            detail.status === "paused"
              ? "Paused"
              : detail.nextCheckAt
                ? clockLabel(detail.nextCheckAt, now)
                : "Soon"
          }
        />
        <RailRow label={brief ? "Runs" : "Checks"} value={detail.week.checks} />
        <RailRow
          label={brief ? "Briefs sent" : "Alerts"}
          value={brief ? briefsSent(detail, now, 7) : detail.week.alerts}
        />
      </RailRows>
      <div className="mt-3">
        <CheckStrip marks={detail.strip} size="big" legend />
      </div>
    </RailSection>
  );
}

type Item = { at: number; alert?: AlertView; rearm?: Rearm };

/**
 * One alert in Recent alerts: its headline and when, what the AI judge did
 * (the "Not checked by AI" pill and its line), who else saw it, Useful / Not
 * useful, and "How this came to you".
 */
function AlertItem({ detail, alert }: { detail: BotDetail; alert: AlertView }) {
  // Held by the judge, or folded into another bot's alert on the same thing.
  const eyebrow = alert.held === "judged" ? "Held back by AI" : null;
  const quiet = alert.held === "judged" || alert.held === "shared";
  return (
    <li className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0">
      {eyebrow ? (
        <span className="pl-3.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {eyebrow}
        </span>
      ) : null}
      <span className="flex min-w-0 items-center gap-2">
        <i
          aria-hidden
          className={cn(
            "block size-1.5 shrink-0 rounded-full",
            quiet ? "bg-muted-foreground/60" : "bg-primary",
          )}
        />
        <span
          className={cn(
            "truncate text-[13px] font-semibold",
            quiet ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {alertHeadline(alert, detail.name, false).title}
        </span>
      </span>
      <span className="pl-3.5 text-xs tabular-nums text-muted-foreground">
        {alertMeta(alert)}
      </span>
      <AiAlertLine alert={alert} variant="full" className="pl-3.5" />
      <div className="flex flex-col items-start gap-1 pl-3.5 pt-1">
        {/* As wide as the "Why not?" popover (w-72) or the item, whichever is
            narrower, so the popover stays in the item and near its button. */}
        <div className="w-full max-w-72">
          <AlertFeedback botId={detail.id} alert={alert} align="end" />
        </div>
        <HowItCame bot={detail} alert={alert} links={detail.links} />
      </div>
    </li>
  );
}

/**
 * A brief's newest brief: what it listed, one line per find. The lines are
 * shown even beside an AI-written body, which may leave some out.
 */
function LastBriefSection({ detail, now }: { detail: BotDetail; now: Date }) {
  const last = (detail.alerts ?? []).find((a) => a.kind === "brief");
  const lines = last?.lines ?? [];
  const written = last && last.aiState === "judged" ? last.body.trim() : "";
  return (
    <RailSection
      title="Last brief"
      meta={last ? agoLabel(last.createdAt, now) : undefined}
    >
      {!last ? (
        <RailEmpty>
          No brief yet. The first one goes out at{" "}
          {detail.briefTime || DEFAULT_BRIEF_TIME}, once its bots find
          something.
        </RailEmpty>
      ) : (
        <>
          {written ? (
            <p className="mb-2.5 whitespace-pre-line rounded-[10px] bg-fill px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
              {written}
            </p>
          ) : null}
          {lines.length ? (
            <RailRows>
              {lines.map((line, i) => (
                <li
                  key={`${i}-${line}`}
                  className="border-t border-border py-2 text-[13px] leading-5 text-foreground first:border-t-0"
                >
                  {line}
                </li>
              ))}
            </RailRows>
          ) : (
            <RailEmpty>{last.body || last.title}</RailEmpty>
          )}
        </>
      )}
    </RailSection>
  );
}

function AlertsSection({ detail }: { detail: BotDetail }) {
  const brief = detail.kind === "brief";
  const alerts = (detail.alerts ?? []).filter(
    (a) => a.kind === "alert" || (brief && a.kind === "brief"),
  );
  const items: Item[] = [
    ...alerts.map((alert) => ({ at: Date.parse(alert.createdAt), alert })),
    ...(detail.rearms ?? []).map((rearm) => ({
      at: Date.parse(rearm.at),
      rearm,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const ruleOf = (r: Rearm) =>
    detail.watches
      .find((w) => w.id === r.watchId)
      ?.rules.find((x) => x.id === r.ruleId);
  return (
    <RailSection
      title="Recent alerts"
      // A brief's month is not counted on the bot (alerts only), and its
      // recent rows are too few to count 30 daily briefs: no meta.
      meta={brief ? undefined : `${detail.alertsMonth} in 30 days`}
    >
      {items.length === 0 ? (
        <RailEmpty>
          {brief
            ? "No briefs yet. Each one shows here once it is sent."
            : "No alerts yet. A rule tells you once when it becomes true."}
        </RailEmpty>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) =>
            item.alert ? (
              <AlertItem
                key={item.alert.id}
                detail={detail}
                alert={item.alert}
              />
            ) : item.rearm ? (
              <li
                key={`rearm-${item.rearm.at}-${item.rearm.ruleId}`}
                className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <i
                    aria-hidden
                    className="block size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                  />
                  <span className="truncate text-[13px] font-medium text-muted-foreground">
                    Armed again, no alert
                  </span>
                </span>
                <span className="pl-3.5 text-xs tabular-nums text-muted-foreground">
                  {rearmMeta(item.rearm, ruleOf(item.rearm))}
                </span>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </RailSection>
  );
}

/**
 * "Right now it reads …": a bot an outside app made, read once so the person
 * can look it over. Nothing is fetched until the person asks for it here, so
 * opening the bot (from the board, a link, or Previous / Next) reads nothing.
 */
function LookOverSection({ botId }: { botId: string }) {
  const [asked, setAsked] = useState(false);
  const preview = useBotPreview({ botId }, asked);
  const rows = preview.data?.watches ?? [];
  return (
    <RailSection
      title="Right now it reads"
      meta="Read once, nothing saved"
      className="border-warning/45"
    >
      {!asked && !preview.data ? (
        <div className="flex flex-col items-start gap-3">
          <RailEmpty>
            Nothing has been read yet. Read its watches once to see what it
            would find before you turn it on.
          </RailEmpty>
          <Button
            variant="outline"
            size="sm"
            leading={<Eye />}
            onClick={() => setAsked(true)}
          >
            Read it once now
          </Button>
        </div>
      ) : preview.isLoading ? (
        <RailEmpty>Reading it once…</RailEmpty>
      ) : preview.error ? (
        <RailEmpty>{preview.error.message}</RailEmpty>
      ) : (
        <RailRows>
          {rows.map((r) => (
            <RailRow
              key={r.index}
              label={r.site || r.summary || "Watch"}
              meta={
                r.ok ? r.excerpt?.text || r.text || undefined : r.health?.line
              }
              value={r.ok ? r.summary : "Can’t read"}
              tone={r.ok ? "default" : "danger"}
            />
          ))}
        </RailRows>
      )}
    </RailSection>
  );
}

/**
 * The open bot's rail: its price over 30 days (or the latest reading of a
 * page or feed), this week's checks with the strip, and recent alerts with
 * Useful / Not useful, re-arms in between. A bot waiting for the person's OK
 * starts with a card that reads it once when the person asks.
 */
export function BotRail({
  detail,
  now,
  lookOver,
}: {
  detail: BotDetail;
  now: Date;
  lookOver?: boolean;
}) {
  if (detail.kind === "brief") {
    return (
      <>
        <ChecksSection detail={detail} now={now} />
        <LastBriefSection detail={detail} now={now} />
        <AlertsSection detail={detail} />
      </>
    );
  }
  const prices = detail.watches.filter(isPriceReading);
  const readings = detail.watches.filter((w) => !isPriceReading(w));
  return (
    <>
      {lookOver ? <LookOverSection botId={detail.id} /> : null}
      {prices.length ? (
        <PriceSection key={`p-${detail.id}`} detail={detail} watches={prices} />
      ) : null}
      {readings.length ? (
        <ReadingSection key={`r-${detail.id}`} watches={readings} now={now} />
      ) : null}
      <ChecksSection detail={detail} now={now} />
      <AlertsSection detail={detail} />
    </>
  );
}

/** The new bot's rail: how it lands on the board, what happens after Create, and the limits. */
export function NewBotRail({
  draft,
  now,
  preview,
}: {
  draft: BotInput;
  now: Date;
  preview?: PreviewResult | null;
}) {
  const actions = useBotActions(() => {});
  const card = previewCard(draft, preview, now);
  const brief = draft.kind === "brief";
  return (
    <>
      <RailSection title="On your board">
        {draft.watches.length || brief ? (
          <div className="[&>article]:border-dashed">
            <BotCard bot={card} now={now} variant="preview" actions={actions} />
          </div>
        ) : (
          <article className="flex flex-col rounded-[12px] border border-dashed border-border-strong">
            <div className="flex items-center gap-3 p-3.5 pb-0">
              <BotMark watches={[]} size={32} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-muted-foreground">
                  {draft.name.trim() || "Name your bot"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  No watch yet
                </p>
              </div>
            </div>
            <p className="px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
              The current reading shows here once you pick a watch.
            </p>
            <div className="flex items-center gap-1.5 border-t border-border px-3.5 py-2.5 text-xs text-muted-foreground">
              <i
                aria-hidden
                className="block size-1.5 rounded-full bg-muted-foreground/60"
              />
              Not checked yet
            </div>
          </article>
        )}
      </RailSection>
      {brief ? null : (
        <RailSection title="After you create it">
          <RailRows>
            <RailRow label="First check" value="Right away" />
            <RailRow label="First reading" value="Kept quietly" tone="muted" />
            <RailRow
              label="Alerts"
              value={`Up to ${BOT_LIMITS.alertsPerDay} a day`}
            />
          </RailRows>
          <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
            The first check only records where things stand. Alerts start from
            the next change.
          </p>
        </RailSection>
      )}
      <RailSection title="Limits" meta="Kept by Timely">
        <RailRows>
          {limitRows().map(([label, value]) => (
            <RailRow key={label} label={label} value={value} />
          ))}
        </RailRows>
      </RailSection>
    </>
  );
}

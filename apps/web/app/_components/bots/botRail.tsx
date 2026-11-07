"use client";

import { useState } from "react";
import { ExternalLink, Eye } from "lucide-react";
import {
  BOT_LIMITS,
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
import { AlertFeedback } from "./alertFeedback";
import { useBotActions } from "./botActions";
import { BotCard } from "./botCard";
import { BotMark } from "./botMark";
import { CheckStrip } from "./checkStrip";
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

function ChecksSection({ detail, now }: { detail: BotDetail; now: Date }) {
  const last = detail.checks?.[0];
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
          label="Next check"
          value={
            detail.status === "paused"
              ? "Paused"
              : detail.nextCheckAt
                ? clockLabel(detail.nextCheckAt, now)
                : "Soon"
          }
        />
        <RailRow label="Checks" value={detail.week.checks} />
        <RailRow label="Alerts" value={detail.week.alerts} />
      </RailRows>
      <div className="mt-3">
        <CheckStrip marks={detail.strip} size="big" legend />
      </div>
    </RailSection>
  );
}

type Item = { at: number; alert?: AlertView; rearm?: Rearm };

function AlertsSection({ detail }: { detail: BotDetail }) {
  const alerts = (detail.alerts ?? []).filter((a) => a.kind === "alert");
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
      meta={`${detail.alertsMonth} in 30 days`}
    >
      {items.length === 0 ? (
        <RailEmpty>
          No alerts yet. A rule tells you once when it becomes true.
        </RailEmpty>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) =>
            item.alert ? (
              <li
                key={item.alert.id}
                className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <i
                    aria-hidden
                    className="block size-1.5 shrink-0 rounded-full bg-primary"
                  />
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {alertHeadline(item.alert, detail.name, false).title}
                  </span>
                </span>
                <span className="pl-3.5 text-xs tabular-nums text-muted-foreground">
                  {alertMeta(item.alert)}
                </span>
                <div className="pl-3.5 pt-1">
                  <AlertFeedback
                    botId={detail.id}
                    alert={item.alert}
                    align="end"
                  />
                </div>
              </li>
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
  return (
    <>
      <RailSection title="On your board">
        {draft.watches.length ? (
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
          The first check only records where things stand. Alerts start from the
          next change.
        </p>
      </RailSection>
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

"use client";

import { useState } from "react";
import {
  axisMoney,
  formatMoney,
  priceDayLabels,
  priceDomain,
  shortDate,
} from "@timely/contract/bots";
import { useElementSize } from "@/app/_components/report/charts";

const AXIS_LEFT = 44;
const AXIS_BOTTOM = 20;
const PAD_TOP = 8;
const PAD_RIGHT = 8;
/** Room the low point's price label needs to the right of its dot. */
const LOW_LABEL_ROOM = 64;

/**
 * A price watch's last 30 days: daily closes as a line over a soft area, the
 * rule's line dashed and labelled ("Your line ₹25,000"), the low point and
 * the newest point marked, three gridlines and first / middle / Today under
 * it. Hover shows the day and its price.
 */
export function PriceChart({
  points,
  threshold,
  currency,
  height = 150,
}: {
  /** [unixSeconds, price], oldest first. */
  points: [number, number][];
  threshold?: number | null;
  currency: string;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = size.width;
  if (points.length < 2) {
    return (
      <div
        ref={ref}
        className="grid h-24 place-items-center rounded-[10px] bg-fill text-xs text-muted-foreground"
      >
        The line fills in after a few days of checks
      </div>
    );
  }
  const { lo, hi, ticks } = priceDomain(points, threshold ?? null);
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT);
  const plotH = Math.max(0, height - AXIS_BOTTOM - PAD_TOP);
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) =>
    AXIS_LEFT + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const line = points
    .map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const base = PAD_TOP + plotH;
  const area = `${line} L${x(t1).toFixed(1)} ${base} L${x(t0).toFixed(1)} ${base} Z`;
  let low = 0;
  points.forEach(([, v], i) => {
    if (v < points[low][1]) low = i;
  });
  const last = points.length - 1;
  const lowFlips = x(points[low][0]) > width - LOW_LABEL_ROOM;
  // Daily closes sit at UTC midnight, so their days are UTC days (priceDayLabels).
  const day = (t: number) => shortDate(new Date(t * 1000).toISOString(), "UTC");
  const label = `Price over the last ${points.length} readings, from ${formatMoney(points[0][1], currency)} to ${formatMoney(points[last][1], currency)}; lowest ${formatMoney(points[low][1], currency)}`;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    points.forEach(([t], i) => {
      if (Math.abs(x(t) - px) < Math.abs(x(points[best][0]) - px)) best = i;
    });
    setHover(best);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block overflow-visible"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={AXIS_LEFT}
                x2={AXIS_LEFT + plotW}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={AXIS_LEFT - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {axisMoney(tick, currency)}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--chart-1)" fillOpacity={0.1} />
          {threshold != null ? (
            <>
              <line
                className="chart-threshold"
                x1={AXIS_LEFT}
                x2={AXIS_LEFT + plotW}
                y1={y(threshold)}
                y2={y(threshold)}
              />
              <text
                x={AXIS_LEFT + 4}
                y={y(threshold) - 5}
                className="fill-warning-text text-[11px] font-medium tabular-nums"
              >
                Your line {formatMoney(threshold, currency)}
              </text>
            </>
          ) : null}
          <path
            d={line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {low !== last ? (
            <>
              <circle
                cx={x(points[low][0])}
                cy={y(points[low][1])}
                r={3.5}
                fill="var(--chart-1)"
                stroke="var(--card)"
                strokeWidth={2}
              />
              {/* Near the right edge the label goes left of its dot, so a
                  card around the chart never clips it. */}
              <text
                x={x(points[low][0]) + (lowFlips ? -6 : 6)}
                y={y(points[low][1]) - 6}
                textAnchor={lowFlips ? "end" : "start"}
                className="fill-foreground text-[11px] font-semibold tabular-nums"
              >
                {formatMoney(points[low][1], currency)}
              </text>
            </>
          ) : null}
          <circle
            cx={x(t1)}
            cy={y(points[last][1])}
            r={3.5}
            fill="var(--chart-1)"
            stroke="var(--card)"
            strokeWidth={2}
          />
          {priceDayLabels(points).map(({ t, label: text, anchor }) => (
            <text
              key={anchor}
              x={x(t)}
              y={height - 4}
              textAnchor={anchor}
              className="fill-muted-foreground text-[10px]"
            >
              {text}
            </text>
          ))}
          {hover !== null ? (
            <>
              <line
                x1={x(points[hover][0])}
                x2={x(points[hover][0])}
                y1={PAD_TOP}
                y2={base}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              <circle
                cx={x(points[hover][0])}
                cy={y(points[hover][1])}
                r={3.5}
                fill="var(--chart-1)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </>
          ) : null}
        </svg>
      ) : null}
      {hover !== null && width > 0 ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs tabular-nums text-popover-foreground shadow-lg"
          style={{
            left:
              x(points[hover][0]) > width - 120
                ? undefined
                : x(points[hover][0]) + 10,
            right:
              x(points[hover][0]) > width - 120
                ? width - x(points[hover][0]) + 10
                : undefined,
            top: Math.max(0, y(points[hover][1]) - 34),
          }}
        >
          <span className="text-muted-foreground">
            {hover === last ? "Now" : day(points[hover][0])}
          </span>{" "}
          <span className="font-semibold">
            {formatMoney(points[hover][1], currency)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

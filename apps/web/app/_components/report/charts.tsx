"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { formatMetric, type CardUnit, type SeriesPoint } from "@timely/contract/dashboard";
import { cn } from "@/app/utils/cn";

/** Categorical slot `index` (0-based) as a CSS colour; past 8 it is "other". */
export function seriesColor(index: number, other = false) {
  if (other || index >= 8) return "var(--series-other)";
  return `var(--series-${index + 1})`;
}

/**
 * Tracks an element's content box so charts draw at their real pixel size.
 * The ref is a callback so a remounted element (a card switching views) is
 * measured again instead of the detached one.
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, ref] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5 ? current : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [ref, size] as const;
}

/** A clean axis maximum: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width - 140;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg"
      style={{
        left: flip ? undefined : x + 10,
        right: flip ? width - x + 10 : undefined,
        top: Math.max(0, y - 34),
      }}
    >
      {children}
    </div>
  );
}

function valueText(value: number, unit: CardUnit) {
  return formatMetric(value, unit);
}

/**
 * Horizontal bars for categories: label above, value at the tip, so long
 * names never get cut. Hover shows the share of the total.
 */
export function CategoryBars({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const max = Math.max(...points.map((point) => point.value), 0) || 1;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return (
    <ul className="flex h-full flex-col justify-start gap-2.5 overflow-y-auto pr-1">
      {points.map((point) => (
        <li key={point.key} title={`${point.label}: ${valueText(point.value, unit)}${total ? ` (${Math.round((point.value / total) * 100)}%)` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-foreground">{point.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{valueText(point.value, unit)}</span>
          </div>
          <div className="h-2 rounded-r-[4px]" style={{ width: `${Math.max((point.value / max) * 100, point.value > 0 ? 2 : 0)}%`, background: seriesColor(point.other ? 8 : color, point.other), minWidth: point.value > 0 ? 4 : 0 }} />
        </li>
      ))}
    </ul>
  );
}

const AXIS_LEFT = 32;
const AXIS_BOTTOM = 20;
const PAD_TOP = 18;
const PAD_RIGHT = 12;

function xLabelStride(count: number, width: number) {
  const fit = Math.max(1, Math.floor(width / 48));
  return Math.max(1, Math.ceil(count / fit));
}

/** Columns over time (or any short ordered series): one baseline, 4px rounded tops. */
export function ColumnChart({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = size.width;
  const height = size.height;
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT);
  const plotH = Math.max(0, height - AXIS_BOTTOM - PAD_TOP);
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.min(24, Math.max(2, band - 2));
  const stride = xLabelStride(points.length, plotW);
  const fill = seriesColor(color);

  return (
    <div ref={ref} className="relative h-full w-full" onPointerLeave={() => setHover(null)}>
      {width > 0 && height > 0 ? (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Column chart">
          {[0, 0.5, 1].map((tick) => {
            const y = PAD_TOP + plotH - tick * plotH;
            return (
              <g key={tick}>
                <line x1={AXIS_LEFT} x2={AXIS_LEFT + plotW} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={AXIS_LEFT - 6} y={y} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {valueText(max * tick, unit)}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const h = (point.value / max) * plotH;
            const x = AXIS_LEFT + index * band + (band - barW) / 2;
            const y = PAD_TOP + plotH - h;
            const r = Math.min(4, barW / 2, h);
            const path =
              h <= 0
                ? ""
                : `M${x},${PAD_TOP + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${PAD_TOP + plotH} Z`;
            return (
              <g key={point.key}>
                {path ? <path d={path} fill={point.other ? seriesColor(8, true) : fill} opacity={hover === null || hover === index ? 1 : 0.55} /> : null}
                {index % stride === 0 ? (
                  <text x={AXIS_LEFT + index * band + band / 2} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {point.label}
                  </text>
                ) : null}
                {/* Hit target is the whole band, taller than the mark. */}
                <rect
                  x={AXIS_LEFT + index * band}
                  y={PAD_TOP}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(index)}
                />
              </g>
            );
          })}
        </svg>
      ) : null}
      {hover !== null && points[hover] ? (
        <Tooltip x={AXIS_LEFT + hover * band + band / 2} y={PAD_TOP + plotH - (points[hover].value / max) * plotH} width={width}>
          <span className="text-muted-foreground">{points[hover].detail ?? points[hover].label}</span>{" "}
          <span className="font-medium tabular-nums">{valueText(points[hover].value, unit)}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** A 2px line with a light wash, an end dot and a crosshair tooltip. */
export function LineChart({ points, unit, color }: { points: SeriesPoint[]; unit: CardUnit; color: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = size.width;
  const height = size.height;
  const plotW = Math.max(0, width - AXIS_LEFT - PAD_RIGHT - 18);
  const plotH = Math.max(0, height - AXIS_BOTTOM - PAD_TOP);
  const max = niceMax(Math.max(...points.map((point) => point.value), 0));
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const xAt = (index: number) => AXIS_LEFT + (points.length > 1 ? index * step : plotW / 2);
  const yAt = (value: number) => PAD_TOP + plotH - (value / max) * plotH;
  const stroke = seriesColor(color);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index)},${yAt(point.value)}`).join(" ");
  const area = points.length ? `${line} L${xAt(points.length - 1)},${PAD_TOP + plotH} L${xAt(0)},${PAD_TOP + plotH} Z` : "";
  const stride = xLabelStride(points.length, plotW);
  const last = points.length - 1;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - AXIS_LEFT;
    const index = step ? Math.round(x / step) : 0;
    setHover(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          role="img"
          aria-label="Line chart"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((tick) => {
            const y = PAD_TOP + plotH - tick * plotH;
            return (
              <g key={tick}>
                <line x1={AXIS_LEFT} x2={AXIS_LEFT + plotW} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={AXIS_LEFT - 6} y={y} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {valueText(max * tick, unit)}
                </text>
              </g>
            );
          })}
          {points.map((point, index) =>
            index % stride === 0 ? (
              <text key={point.key} x={xAt(index)} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {point.label}
              </text>
            ) : null,
          )}
          <path d={area} fill={stroke} opacity={0.1} />
          <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last >= 0 ? (
            <>
              <circle cx={xAt(last)} cy={yAt(points[last].value)} r={4} fill={stroke} stroke="var(--card)" strokeWidth={2} />
              <text x={xAt(last) + 8} y={yAt(points[last].value)} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular-nums">
                {valueText(points[last].value, unit)}
              </text>
            </>
          ) : null}
          {hover !== null ? (
            <>
              <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth={1} />
              <circle cx={xAt(hover)} cy={yAt(points[hover].value)} r={4} fill={stroke} stroke="var(--card)" strokeWidth={2} />
            </>
          ) : null}
        </svg>
      ) : null}
      {hover !== null && points[hover] ? (
        <Tooltip x={xAt(hover)} y={yAt(points[hover].value)} width={width}>
          <span className="text-muted-foreground">{points[hover].detail ?? points[hover].label}</span>{" "}
          <span className="font-medium tabular-nums">{valueText(points[hover].value, unit)}</span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** SVG paths for each slice, clockwise from twelve o'clock. */
function donutArcs(points: SeriesPoint[], radius: number, inner: number) {
  const sum = points.reduce((acc, point) => acc + point.value, 0);
  const arcs: { d: string; point: SeriesPoint; index: number }[] = [];
  let angle = -Math.PI / 2;
  const p = (r: number, a: number) => `${radius + r * Math.cos(a)},${radius + r * Math.sin(a)}`;
  points.forEach((point, index) => {
    const sweep = sum ? (point.value / sum) * Math.PI * 2 : 0;
    const start = angle;
    angle += sweep;
    const end = angle;
    const large = sweep > Math.PI ? 1 : 0;
    const d =
      sweep >= Math.PI * 2 - 0.0001
        ? `M${p(radius, 0)} A${radius},${radius} 0 1 1 ${p(radius, Math.PI)} A${radius},${radius} 0 1 1 ${p(radius, 0)} M${p(inner, 0)} A${inner},${inner} 0 1 0 ${p(inner, Math.PI)} A${inner},${inner} 0 1 0 ${p(inner, 0)} Z`
        : `M${p(radius, start)} A${radius},${radius} 0 ${large} 1 ${p(radius, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z`;
    arcs.push({ d, point, index });
  });
  return arcs;
}

/** Donut with a 2px surface gap between segments and a legend that names every slice. */
export function DonutChart({ points, unit, total }: { points: SeriesPoint[]; unit: CardUnit; total: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const sum = points.reduce((acc, point) => acc + point.value, 0);
  const wide = size.width > size.height * 1.35;
  const diameter = Math.max(0, Math.min(wide ? size.height : size.width, wide ? size.width * 0.5 : size.height * 0.62, 220));
  const radius = diameter / 2;
  const thickness = Math.max(10, Math.min(22, radius * 0.32));
  const inner = radius - thickness;

  const arcs = donutArcs(points, radius, inner);

  const focus = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className={cn("flex h-full w-full items-center gap-4", wide ? "flex-row" : "flex-col")}>
      {diameter > 0 ? (
        <div className="relative shrink-0" style={{ width: diameter, height: diameter }}>
          <svg width={diameter} height={diameter} role="img" aria-label="Donut chart" onPointerLeave={() => setHover(null)}>
            {arcs.map(({ d, point, index }) => (
              <path
                key={point.key}
                d={d}
                fill={seriesColor(index, point.other)}
                fillRule="evenodd"
                stroke="var(--card)"
                strokeWidth={2}
                opacity={hover === null || hover === index ? 1 : 0.45}
                onPointerEnter={() => setHover(index)}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-lg font-semibold tabular-nums text-foreground">{valueText(focus ? focus.value : total, unit)}</span>
            <span className="max-w-[80%] truncate text-[10px] text-muted-foreground">{focus ? focus.label : "Total"}</span>
          </div>
        </div>
      ) : null}
      <ul className="min-w-0 flex-1 self-stretch overflow-y-auto text-xs" onPointerLeave={() => setHover(null)}>
        {points.map((point, index) => (
          <li
            key={point.key}
            className={cn("flex items-center gap-2 rounded px-1 py-0.5", hover === index && "bg-accent/60")}
            onPointerEnter={() => setHover(index)}
          >
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(index, point.other) }} />
            <span className="min-w-0 flex-1 truncate text-foreground">{point.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {valueText(point.value, unit)}
              {sum ? ` · ${Math.round((point.value / sum) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A meter: the track is a pale step of the same hue as the fill. */
export function Meter({ value, color, className }: { value: number; color: number | string; className?: string }) {
  const fill = typeof color === "string" ? color : seriesColor(color);
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full", className)} style={{ background: `color-mix(in oklch, ${fill} 18%, transparent)` }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: fill }} />
    </div>
  );
}

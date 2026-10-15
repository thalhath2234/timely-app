"use client";

import { formatDuration, formatTime } from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import type { CalendarItem } from "@/app/_types/types";

/** Pixels per hour on the Today timeline: a 15-minute block is 13px, enough
 * for one line of 11px text with the block's minimum height. */
const HOUR_PX = 52;
const MIN_BLOCK_PX = 22;
const GUTTER = "3.25rem";

function parse(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function hourLabel(hour: number) {
  return new Date(2000, 0, 1, hour)
    .toLocaleTimeString(undefined, { hour: "numeric" })
    .replace(/\s/g, " ");
}

/** Whole hours the day view covers: 8 AM to 6 PM at least, widened to every
 * timed block and the current time. */
export function timelineRange(items: CalendarItem[], now: number) {
  const nowHour = new Date(now).getHours();
  // An empty day shows a few hours around now, not a tall empty grid.
  if (items.length === 0) {
    const from = Math.max(0, Math.min(nowHour - 1, 20)) * 60;
    return { from, to: from + 4 * 60 };
  }
  const minutes = items.flatMap((item) => {
    const start = parse(item.start);
    const end = parse(item.end);
    return [start, end].filter((d): d is Date => Boolean(d)).map(minutesOfDay);
  });
  minutes.push(minutesOfDay(new Date(now)));
  const from = Math.max(0, Math.min(8 * 60, Math.floor(Math.min(...minutes) / 60) * 60));
  const to = Math.min(24 * 60, Math.max(18 * 60, Math.ceil(Math.max(...minutes) / 60) * 60));
  return { from, to };
}

/** Side-by-side columns for blocks that overlap in time. */
function packColumns(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const placed: { item: CalendarItem; column: number; columns: number }[] = [];
  let group: { item: CalendarItem; column: number; columns: number }[] = [];
  let groupEnd = 0;
  const columnEnds: number[] = [];
  const close = () => {
    const columns = Math.max(1, ...group.map((entry) => entry.column + 1));
    for (const entry of group) entry.columns = columns;
    placed.push(...group);
    group = [];
    columnEnds.length = 0;
  };
  for (const item of sorted) {
    const start = parse(item.start)?.getTime() ?? 0;
    const end = parse(item.end)?.getTime() ?? start;
    if (group.length && start >= groupEnd) close();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = end;
    group.push({ item, column, columns: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  if (group.length) close();
  return placed;
}

/** Today's blocks and events on a vertical clock, with reminders pinned at
 * their time, the free time until the next item and a line at now. */
export default function DayTimeline({
  items,
  reminders,
  now,
  accent,
  meetingUrl,
  onOpen,
  onContextMenu,
}: {
  items: CalendarItem[];
  reminders: CalendarItem[];
  now: number;
  accent: (item: CalendarItem) => string;
  meetingUrl: (item: CalendarItem) => string | null;
  onOpen: (item: CalendarItem) => void;
  onContextMenu?: (event: React.MouseEvent, item: CalendarItem) => void;
}) {
  const { from, to } = timelineRange(items, now);
  const height = ((to - from) / 60) * HOUR_PX;
  const y = (minutes: number) => ((Math.min(Math.max(minutes, from), to) - from) / 60) * HOUR_PX;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from / 60 + i);
  const nowDate = new Date(now);
  const nowMinutes = minutesOfDay(nowDate);

  const next = items
    .map((item) => parse(item.start))
    .filter((date): date is Date => Boolean(date && date.getTime() > now))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const busyNow = items.some((item) => {
    const start = parse(item.start)?.getTime() ?? 0;
    const end = parse(item.end)?.getTime() ?? 0;
    return start <= now && end > now;
  });
  const freeMinutes = next && !busyNow ? Math.round((next.getTime() - now) / 60_000) : 0;

  return (
    <div className="relative" style={{ height: height + 8 }} data-testid="today-timeline">
      {hours.map((hour) => (
        <div
          key={hour}
          className="pointer-events-none absolute inset-x-0 border-t border-border"
          style={{ top: y(hour * 60) + 4 }}
        >
          <span className="absolute -top-2 left-0 bg-card pr-1.5 text-[11px] tabular-nums leading-4 text-muted-foreground">
            {hourLabel(hour)}
          </span>
        </div>
      ))}

      {freeMinutes >= 15 ? (
        <div
          className="absolute right-0 overflow-hidden rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground"
          style={{
            left: GUTTER,
            top: y(nowMinutes) + 6,
            height: Math.max(y(minutesOfDay(next!)) - y(nowMinutes) - 4, 18),
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--muted) 80%, transparent) 6px 7px)",
          }}
        >
          Free until {formatTime(next!)} · {formatDuration(freeMinutes)}
        </div>
      ) : null}

      {packColumns(items).map(({ item, column, columns }) => {
        const start = parse(item.start);
        const end = parse(item.end);
        if (!start || !end) return null;
        const top = y(minutesOfDay(start));
        const bottom = y(end.getDate() !== start.getDate() ? to : minutesOfDay(end));
        const blockHeight = Math.max(bottom - top - 2, MIN_BLOCK_PX);
        const color = accent(item);
        const meet = meetingUrl(item);
        const done = Boolean(item.completedAt || item.task?.completedAt);
        const roomy = blockHeight >= 38;
        return (
          <div
            key={item.id}
            className="absolute"
            style={{
              top: top + 5,
              height: blockHeight,
              left: `calc(${GUTTER} + (100% - ${GUTTER}) * ${column / columns})`,
              width: `calc((100% - ${GUTTER}) / ${columns} - 2px)`,
            }}
          >
            <button
              type="button"
              title={`${item.title} · ${formatTime(start)} – ${formatTime(end)}`}
              onClick={() => onOpen(item)}
              onContextMenu={(event) => onContextMenu?.(event, item)}
              className={cn(
                "flex size-full flex-col overflow-hidden rounded-md border-l-[3px] px-2 text-left transition-[filter] hover:brightness-110",
                roomy ? "py-1" : "justify-center",
                done && "opacity-60",
              )}
              style={{
                backgroundColor: `color-mix(in oklab, ${color} 18%, var(--card))`,
                borderLeftColor: color,
                color: "var(--foreground)",
              }}
            >
              <span className={cn("truncate text-xs font-medium leading-4", done && "line-through")}>{item.title}</span>
              {roomy ? (
                <span className="truncate text-[11px] leading-4 text-muted-foreground tabular-nums">
                  {formatTime(start)} – {formatTime(end)}
                  {item.taskId ? " · Focus block" : ""}
                </span>
              ) : null}
            </button>
            {meet && roomy ? (
              <a
                href={meet}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-1 right-2 text-[11px] font-medium text-primary hover:underline"
              >
                Join call
              </a>
            ) : null}
          </div>
        );
      })}

      {reminders.map((item) => {
        const start = parse(item.start);
        if (!start) return null;
        const minutes = minutesOfDay(start);
        if (minutes < from || minutes > to) return null;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item)}
            onContextMenu={(event) => onContextMenu?.(event, item)}
            title={`${item.title} · ${formatTime(start)}`}
            className="absolute right-0 z-[1] flex -translate-y-1/2 items-center gap-1.5 text-[11px] font-medium text-warning"
            style={{ left: GUTTER, top: y(minutes) + 4 }}
          >
            <span className="size-2 shrink-0 rounded-full bg-warning" />
            <span className="truncate">{item.title}</span>
            <span className="h-px min-w-4 flex-1 border-t border-dashed border-warning/60" />
          </button>
        );
      })}

      {nowMinutes >= from && nowMinutes <= to ? (
        <div
          className="pointer-events-none absolute right-0 z-[2] border-t-2 border-destructive"
          style={{ left: "2.75rem", top: y(nowMinutes) + 4 }}
          title="Now"
        >
          <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-destructive" />
          <span className="absolute -top-4 right-0 text-[11px] font-semibold tabular-nums text-destructive">
            {formatTime(nowDate)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

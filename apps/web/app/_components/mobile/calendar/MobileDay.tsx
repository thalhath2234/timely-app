"use client";

import { useEffect, useRef } from "react";
import type { CalendarItem } from "@/app/_types/types";
import { HOURS, formatHour } from "@/app/_types/types";
import { isSameDay, startOfDay } from "@/app/_lib/mobile/format";
import { itemColor } from "./CalendarItemRow";

const HOUR_PX = 56;

interface MobileDayProps {
  date: Date;
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
}

/** Lays out overlapping items side-by-side within the hour rail. */
function layout(items: CalendarItem[]) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const placed: { item: CalendarItem; col: number; cols: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) c.cols = cols;
    placed.push(...cluster);
    cluster = [];
  };

  for (const item of sorted) {
    const s = new Date(item.start).getTime();
    const e = new Date(item.end).getTime();
    if (s >= clusterEnd) flush();
    const taken = new Set(
      cluster
        .filter((c) => new Date(c.item.end).getTime() > s)
        .map((c) => c.col),
    );
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ item, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return placed;
}

export default function MobileDay({ date, items, onOpen }: MobileDayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dayStart = startOfDay(date).getTime();
  const isToday = isSameDay(date, new Date());
  const now = new Date();
  const nowY = ((now.getTime() - dayStart) / 3_600_000) * HOUR_PX;

  const allDay = items.filter((i) => i.allDay);
  const timed = layout(items.filter((i) => !i.allDay));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = isToday ? Math.max(0, nowY - 160) : 7 * HOUR_PX;
    el.scrollTo({ top: target, behavior: "instant" });
  }, [dayStart, isToday]);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {allDay.length ? (
        <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
          {allDay.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item)}
              className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-foreground"
              style={{ backgroundColor: `color-mix(in oklch, ${itemColor(item)} 22%, transparent)` }}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: itemColor(item) }} />
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
        <div className="w-14 shrink-0">
          {HOURS.map((h) => (
            <div
              key={h}
              className="relative text-right text-[11px] text-muted-foreground"
              style={{ height: HOUR_PX }}
            >
              <span className="absolute -top-2 right-2">{formatHour(h)}</span>
            </div>
          ))}
        </div>
        <div className="relative flex-1 border-l border-border">
          {HOURS.map((h) => (
            <div
              key={h}
              className="border-t border-border/70"
              style={{ height: HOUR_PX }}
            />
          ))}

          {timed.map(({ item, col, cols }) => {
            const s = new Date(item.start).getTime();
            const e = new Date(item.end).getTime();
            const top = ((s - dayStart) / 3_600_000) * HOUR_PX;
            const height = Math.max(26, ((e - s) / 3_600_000) * HOUR_PX - 2);
            const width = 100 / cols;
            const done = Boolean(item.completedAt);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="absolute overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left transition-transform active:scale-[0.98]"
                style={{
                  top,
                  height,
                  left: `calc(${col * width}% + 4px)`,
                  width: `calc(${width}% - 8px)`,
                  borderLeftColor: itemColor(item),
                  backgroundColor: `color-mix(in oklch, ${itemColor(item)} ${done ? 10 : 20}%, var(--card))`,
                }}
              >
                <p
                  className={`truncate text-[13px] font-medium leading-4 ${
                    done ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {item.title}
                </p>
                {height > 40 ? (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {new Date(item.start).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                ) : null}
              </button>
            );
          })}

          {isToday ? (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
              style={{ top: nowY }}
            >
              <span className="-ml-1.5 h-3 w-3 rounded-full bg-destructive" />
              <span className="h-px flex-1 bg-destructive" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

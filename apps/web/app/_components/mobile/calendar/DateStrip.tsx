"use client";

import { useEffect, useRef } from "react";
import { addDays, dayKey, isSameDay, startOfDay } from "@/app/_lib/mobile/format";

interface DateStripProps {
  selected: Date;
  onSelect: (d: Date) => void;
  /** Day keys that have at least one item; renders a dot. */
  busyDays: Set<string>;
}

/** Three weeks of scrollable days centered on the selected week. */
export default function DateStrip({ selected, onSelect, busyDays }: DateStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const today = startOfDay(new Date());
  const weekStart = addDays(startOfDay(selected), -selected.getDay());
  const days = Array.from({ length: 21 }, (_, i) => addDays(weekStart, i - 7));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth, behavior: "instant" });
  }, [weekStart.getTime()]);

  return (
    <div
      ref={ref}
      className="flex snap-x snap-mandatory overflow-x-auto px-1 pb-3 scrollbar-none"
    >
      {Array.from({ length: 3 }, (_, w) => (
        <div key={w} className="flex w-full shrink-0 snap-start justify-between px-2">
          {days.slice(w * 7, w * 7 + 7).map((d) => {
            const isSelected = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            const busy = busyDays.has(dayKey(d));
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onSelect(d)}
                aria-pressed={isSelected}
                aria-label={d.toDateString()}
                className="flex w-11 flex-col items-center gap-1 py-1"
              >
                <span className="text-[11px] font-medium uppercase text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isToday
                        ? "text-primary"
                        : "text-foreground"
                  }`}
                >
                  {d.getDate()}
                </span>
                <span
                  className={`h-1 w-1 rounded-full ${
                    busy ? (isSelected ? "bg-primary" : "bg-muted-foreground/70") : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

"use client";

import { CalendarDays } from "lucide-react";
import type { CalendarItem } from "@/app/_types/types";
import { addDays, dayKey, isSameDay, startOfDay } from "@/app/_lib/mobile/format";
import CalendarItemRow, { itemColor } from "./CalendarItemRow";
import EmptyState from "../EmptyState";

interface MobileMonthProps {
  month: Date;
  selected: Date;
  onSelect: (d: Date) => void;
  items: CalendarItem[];
  onOpen: (item: CalendarItem) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function MobileMonth({ month, selected, onSelect, items, onOpen }: MobileMonthProps) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = dayKey(startOfDay(new Date(item.start)));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(item);
  }

  const selectedItems = (byDay.get(dayKey(selected)) ?? []).sort((a, b) =>
    a.start.localeCompare(b.start),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="px-3 pb-3">
        <div className="grid grid-cols-7 pb-1">
          {WEEKDAYS.map((d, i) => (
            <span
              key={`${d}${i}`}
              className="text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const isSel = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            const dayItems = byDay.get(dayKey(d)) ?? [];
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => onSelect(d)}
                aria-pressed={isSel}
                aria-label={d.toDateString()}
                className="flex h-12 flex-col items-center justify-center gap-1"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-[14px] transition-colors ${
                    isSel
                      ? "bg-primary font-semibold text-primary-foreground"
                      : isToday
                        ? "font-semibold text-primary"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/40"
                  }`}
                >
                  {d.getDate()}
                </span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {dayItems.slice(0, 3).map((item) => (
                    <span
                      key={item.id}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: itemColor(item), opacity: inMonth ? 1 : 0.35 }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 border-t border-border bg-sidebar/40 px-3 pb-28">
        <div className="flex items-baseline gap-2 px-1 pt-4 pb-2">
          <h2 className="text-[13px] font-semibold text-foreground">
            {selected.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <span className="text-xs text-muted-foreground">
            {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"}
          </span>
        </div>
        {selectedItems.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Free day" />
        ) : (
          <ul className="flex flex-col gap-2">
            {selectedItems.map((item) => (
              <li key={item.id}>
                <CalendarItemRow item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

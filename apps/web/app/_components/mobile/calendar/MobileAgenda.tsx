"use client";

import { CalendarDays } from "lucide-react";
import type { CalendarItem } from "@/app/_types/types";
import { dayKey, formatRelativeDay, isSameDay, startOfDay } from "@/app/_lib/mobile/format";
import CalendarItemRow from "./CalendarItemRow";
import EmptyState from "../EmptyState";

interface MobileAgendaProps {
  items: CalendarItem[];
  from: Date;
  onOpen: (item: CalendarItem) => void;
}

export default function MobileAgenda({ items, from, onOpen }: MobileAgendaProps) {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const groups = new Map<string, { date: Date; items: CalendarItem[] }>();
  for (const item of sorted) {
    const d = startOfDay(new Date(item.start));
    if (d < startOfDay(from)) continue;
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { date: d, items: [] });
    groups.get(key)!.items.push(item);
  }

  if (groups.size === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Events and scheduled task blocks for the coming days will show here."
      />
    );
  }

  const today = new Date();

  return (
    <div className="flex flex-col px-3">
      {[...groups.values()].map((group) => {
        const isToday = isSameDay(group.date, today);
        return (
          <section key={group.date.toISOString()}>
            <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-background/95 px-1 pt-4 pb-2 backdrop-blur">
              <h2
                className={`text-[13px] font-semibold ${
                  isToday ? "text-primary" : "text-foreground"
                }`}
              >
                {formatRelativeDay(group.date)}
              </h2>
              <span className="text-xs text-muted-foreground">
                {group.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {" · "}
                {group.items.length} {group.items.length === 1 ? "item" : "items"}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <CalendarItemRow item={item} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

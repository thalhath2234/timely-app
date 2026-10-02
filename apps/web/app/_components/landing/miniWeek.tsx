import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { WEEK_DAYS, type CalendarSlot } from "./sampleData";

const DAY_START = 9;
const DAY_HOURS = 8;
const HOUR_MARKS = [9, 11, 13, 15];

/** Position of a calendar slot inside the grid body, in percent of that body. */
export function slotRect(slot: Pick<CalendarSlot, "day" | "start" | "hours">) {
  return {
    left: `${(slot.day * 100) / WEEK_DAYS.length}%`,
    top: `${((slot.start - DAY_START) * 100) / DAY_HOURS}%`,
    width: `${100 / WEEK_DAYS.length}%`,
    height: `${(slot.hours * 100) / DAY_HOURS}%`,
  };
}

/** The app's calendar-item look: a tinted bar with a solid edge in the entity colour. */
export function slotColors(color: string): CSSProperties {
  return {
    background: `color-mix(in oklch, ${color} 24%, var(--card))`,
    borderLeft: `calc(var(--u) * 3) solid ${color}`,
  };
}

/** A Mon–Fri hour grid; children are positioned over the grid body with `slotRect`. */
export function MiniWeek({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-col", className ?? "h-full")}>
      <div className="flex shrink-0 border-b border-border pl-7">
        {WEEK_DAYS.map((day) => (
          <div key={day.short} className="mini-9 flex-1 py-1 text-center text-muted-foreground">
            {day.short} <span className="font-mono text-foreground">{day.date}</span>
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative w-7 shrink-0">
          {HOUR_MARKS.map((hour) => (
            <span
              key={hour}
              className="mini-8 absolute right-1 font-mono text-muted-foreground"
              style={{ top: `calc(${((hour - DAY_START) * 100) / DAY_HOURS}% + var(--u) * 2)` }}
            >
              {String(hour).padStart(2, "0")}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {Array.from({ length: DAY_HOURS - 1 }, (_, index) => (
            <i
              key={`h${index}`}
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${((index + 1) * 100) / DAY_HOURS}%` }}
            />
          ))}
          {WEEK_DAYS.map((day, index) => (
            <i
              key={day.short}
              className="absolute inset-y-0 border-l border-border"
              style={{ left: `${(index * 100) / WEEK_DAYS.length}%` }}
            />
          ))}
          {children}
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { EVENT_BLOCKS, EVENT_COLOR, WEEK_DAYS, WORKING_DAY, type CalendarBlock } from "./sampleData";

const HOUR_MARKS = [9, 11, 13, 15];

/** How far down the grid body an hour sits, in percent of that body. */
export function hourTop(hour: number) {
  return `${((hour - WORKING_DAY.start) * 100) / WORKING_DAY.hours}%`;
}

/** Position of a Block inside the grid body, in percent of that body. */
export function blockRect(block: Pick<CalendarBlock, "day" | "start" | "hours">) {
  return {
    left: `${(block.day * 100) / WEEK_DAYS.length}%`,
    top: hourTop(block.start),
    width: `${100 / WEEK_DAYS.length}%`,
    height: `${(block.hours * 100) / WORKING_DAY.hours}%`,
  };
}

/** The app's calendar-item look: a tinted bar with a solid edge in the entity colour. */
export function blockColors(color: string): CSSProperties {
  return {
    background: `color-mix(in oklab, ${color} 24%, var(--card))`,
    borderLeft: `calc(var(--u) * 3) solid ${color}`,
  };
}

/** The sample week's Events, which are on the calendar before any Work is placed. */
export function EventBlocks({ compact = false }: { compact?: boolean }) {
  return EVENT_BLOCKS.map((block) => (
    <div key={block.title} className="absolute p-px" style={blockRect(block)}>
      <div
        className={cn(
          "h-full overflow-hidden rounded-sm font-medium",
          compact ? "mini-8 px-0.5 py-px leading-tight" : "mini-9 px-1 py-0.5",
        )}
        style={blockColors(EVENT_COLOR)}
      >
        <span className="line-clamp-2">{block.title}</span>
      </div>
    </div>
  ));
}

/** A Mon–Fri hour grid; children are positioned over the grid body with `blockRect`. */
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
              style={{ top: `calc(${hourTop(hour)} + var(--u) * 2)` }}
            >
              {String(hour).padStart(2, "0")}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {Array.from({ length: WORKING_DAY.hours - 1 }, (_, index) => (
            <i
              key={`h${index}`}
              className="absolute inset-x-0 border-t border-border"
              style={{ top: hourTop(WORKING_DAY.start + index + 1) }}
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

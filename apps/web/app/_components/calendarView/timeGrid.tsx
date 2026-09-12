"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatHour, HOURS } from "@/app/_types/types";
import {
  eventsForDay,
  eventStyle,
  formatTime,
  HOUR_HEIGHT,
  isSameDay,
  layoutDayEvents,
  mergeAdjacentTaskBlocks,
  type CalendarEvent,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";

type TimeGridProps = {
  days: Date[];
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  /** Clicking an empty hour opens the schedule dialog for that slot. */
  onSelectSlot?: (day: Date, hour: number) => void;
};

const MIN_BLOCK_HEIGHT = 20;
const REMINDER_HEIGHT = 22;
const GRID_HEIGHT = HOURS.length * HOUR_HEIGHT;

/** Solid 1px rules — borders on tall scrolled columns fail to paint in Chromium. */
function HourLines({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute top-0 right-0", className)}
      style={{ height: GRID_HEIGHT }}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 bg-foreground/20"
          style={{ top: (hour + 1) * HOUR_HEIGHT - 1, height: 1 }}
        />
      ))}
    </div>
  );
}

export default function TimeGrid({
  days,
  events,
  onSelectEvent,
  onSelectSlot,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const visibleEvents = useMemo(
    () =>
      days.map((day) =>
        layoutDayEvents(mergeAdjacentTaskBlocks(eventsForDay(events, day))),
      ),
    [days, events],
  );

  // A full 24-hour grid opens on midnight otherwise, which is rarely useful.
  const anchorKey = days[0]?.toDateString() ?? "";
  const focusHour = useMemo(() => {
    const starts = visibleEvents.flat().map((item) => item.event.startHour);
    return starts.length ? Math.min(...starts) : new Date().getHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, visibleEvents]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = Math.max(0, (focusHour - 1) * HOUR_HEIGHT);
  }, [focusHour, anchorKey]);

  const nowHour = now.getHours() + now.getMinutes() / 60;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 border-b border-border">
        <div className="w-14 shrink-0 border-r border-border" />
        {days.map((day) => {
          const isToday = isSameDay(day, now);
          return (
            <div
              key={`head-${day.toISOString()}`}
              className={cn(
                "flex h-10 min-w-32 flex-1 items-center justify-center gap-1.5 border-r border-border text-sm last:border-r-0",
                isToday ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {day.toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
              })}
              {isToday && <span className="size-1.5 rounded-full bg-primary" />}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ height: GRID_HEIGHT, minHeight: GRID_HEIGHT }}>
          <HourLines className="left-14 z-0" />

          <div className="relative w-14 shrink-0 border-r border-border">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-2 z-[2] text-[10px] tabular-nums text-muted-foreground">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const isToday = isSameDay(day, now);

            return (
              <div
                key={day.toISOString()}
                className="relative min-w-32 flex-1 border-r border-border last:border-r-0"
                style={{ height: GRID_HEIGHT }}
              >
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`Schedule at ${formatHour(hour)} on ${day.toLocaleDateString()}`}
                    onClick={() => onSelectSlot?.(day, hour)}
                    className="block w-full bg-transparent transition-colors hover:bg-accent/30"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 h-0"
                    style={{ top: nowHour * HOUR_HEIGHT }}
                    aria-hidden="true"
                  >
                    <span className="absolute top-0 size-2 -translate-x-1 -translate-y-1/2 rounded-full bg-destructive" />
                    <span className="absolute top-0 left-0 right-0 h-px -translate-y-1/2 bg-destructive" />
                  </div>
                )}

                {visibleEvents[dayIndex].map(({ event, lane, lanes }) => {
                  if (event.reminder) {
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onSelectEvent(event)}
                        style={{
                          top: event.startHour * HOUR_HEIGHT - REMINDER_HEIGHT / 2,
                          height: REMINDER_HEIGHT,
                          left: `calc(${(lane * 100) / lanes}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                          ...eventStyle(event.color),
                        }}
                        className="absolute z-[3] flex items-center gap-1 overflow-hidden rounded-full border bg-card px-2 text-left text-foreground shadow-sm transition-all hover:z-[4] hover:brightness-110"
                      >
                        <Bell className="size-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate text-xs font-medium leading-none">
                          {event.title}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatTime(event.start)}
                        </span>
                      </button>
                    );
                  }

                  const height = Math.max(
                    (event.endHour - event.startHour) * HOUR_HEIGHT - 2,
                    MIN_BLOCK_HEIGHT,
                  );

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onSelectEvent(event)}
                      style={{
                        top: event.startHour * HOUR_HEIGHT,
                        height,
                        left: `calc(${(lane * 100) / lanes}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        ...eventStyle(event.color),
                      }}
                      className="absolute z-[2] flex flex-col overflow-hidden rounded-md border bg-card px-2 py-1 text-left text-foreground transition-all hover:z-[3] hover:shadow-md hover:brightness-110"
                    >
                      <span className="truncate text-xs font-medium leading-tight">
                        {event.title}
                      </span>
                      {height > 36 ? (
                        <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                          {formatTime(event.start)} – {formatTime(event.end)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

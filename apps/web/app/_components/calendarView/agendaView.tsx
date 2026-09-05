"use client";

import { useMemo } from "react";
import {
  addDays,
  eventsForDay,
  formatDuration,
  formatTime,
  isSameDay,
  startOfDay,
  swatchColor,
  type CalendarEvent,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";

const AGENDA_DAYS = 7;

type AgendaViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
};

export default function AgendaView({
  selectedDate,
  events,
  onSelectEvent,
}: AgendaViewProps) {
  const today = startOfDay(new Date());

  const groups = useMemo(() => {
    const start = startOfDay(selectedDate);

    return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i))
      .map((day) => ({ day, dayEvents: eventsForDay(events, day) }))
      .filter((group) => group.dayEvents.length > 0);
  }, [selectedDate, events]);

  const dayLabel = (day: Date) => {
    if (isSameDay(day, today)) return "Today";
    if (isSameDay(day, addDays(today, 1))) return "Tomorrow";
    return day.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto">
      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing on the calendar in this period.
        </p>
      )}

      {groups.map(({ day, dayEvents }) => (
        <div key={day.toISOString()} className="flex flex-col gap-2">
          <h3
            className={cn(
              "text-sm font-semibold",
              isSameDay(day, today) ? "text-primary" : "text-foreground",
            )}
          >
            {dayLabel(day)}
          </h3>

          <div className="flex flex-col gap-1.5">
            {dayEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelectEvent(event)}
                className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatTime(event.start)} – {formatTime(event.end)}
                </span>

                <span
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: swatchColor(event.color) }}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {event.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[event.statusName, event.subtitle]
                      .filter(Boolean)
                      .join(" · ") || "No status"}
                  </p>
                </div>

                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDuration(event.durationMinutes)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

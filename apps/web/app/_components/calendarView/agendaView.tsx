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
  overdueEvents?: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
};

function relativeDay(day: Date, today: Date) {
  if (isSameDay(day, today)) return "Today";
  if (isSameDay(day, addDays(today, 1))) return "Tomorrow";
  if (isSameDay(day, addDays(today, -1))) return "Yesterday";
  return day.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function AgendaRow({
  event,
  overdue,
  today,
  onSelectEvent,
}: {
  event: CalendarEvent;
  overdue?: boolean;
  today: Date;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const when = event.allDay
    ? overdue
      ? `Due ${relativeDay(event.start, today)}`
      : "All day"
    : `${formatTime(event.start)} – ${formatTime(event.end)}`;
  const subtitle = [
    overdue && !event.allDay ? relativeDay(event.start, today) : null,
    event.statusName,
    event.subtitle,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onSelectEvent(event)}
      className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
    >
      <span
        className={cn(
          "w-32 shrink-0 text-xs tabular-nums",
          overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {when}
      </span>

      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: swatchColor(event.color) }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{event.title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle || "No status"}</p>
      </div>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {event.reminder
          ? "Reminder"
          : formatDuration(
              overdue && event.allDay
                ? event.task?.duration || event.durationMinutes
                : event.durationMinutes,
            )}
      </span>
    </button>
  );
}

export default function AgendaView({
  selectedDate,
  events,
  overdueEvents = [],
  onSelectEvent,
}: AgendaViewProps) {
  const today = startOfDay(new Date());

  const groups = useMemo(() => {
    const start = startOfDay(selectedDate);

    return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i))
      .map((day) => ({
        day,
        dayEvents: eventsForDay(events, day).filter((event) => !event.reminder),
      }))
      .filter((group) => group.dayEvents.length > 0);
  }, [selectedDate, events]);

  const empty = groups.length === 0 && overdueEvents.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-auto">
      {empty && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing on the calendar in this period.
        </p>
      )}

      {overdueEvents.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-destructive">Overdue</h3>
          <div className="flex flex-col gap-1.5">
            {overdueEvents.map((event) => (
              <AgendaRow
                key={event.id}
                event={event}
                overdue
                today={today}
                onSelectEvent={onSelectEvent}
              />
            ))}
          </div>
        </div>
      )}

      {groups.map(({ day, dayEvents }) => (
        <div key={day.toISOString()} className="flex flex-col gap-2">
          <h3
            className={cn(
              "text-sm font-semibold",
              isSameDay(day, today) ? "text-primary" : "text-foreground",
            )}
          >
            {relativeDay(day, today)}
          </h3>

          <div className="flex flex-col gap-1.5">
            {dayEvents.map((event) => (
              <AgendaRow
                key={event.id}
                event={event}
                today={today}
                onSelectEvent={onSelectEvent}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

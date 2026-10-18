"use client";

import { useMemo } from "react";
import { RailEmpty, RailRow, RailRows, RailSection, RailStat } from "@/app/_components/_ui/pageWithRail";
import { workdayWindow } from "@timely/contract/dashboard";
import type { WorkingHours } from "@/app/_types/types";
import { formatDuration, isSameDay, swatchColor, type CalendarEvent } from "@/app/utils/calendar";

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes of `window` covered by at least one event: overlaps count once. */
function busyMinutes(events: CalendarEvent[], window: { start: number; end: number }) {
  const spans = events
    .filter((event) => !event.allDay)
    .map((event) => [Math.max(window.start, event.startHour * 60), Math.min(window.end, event.endHour * 60)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -1;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (end > from) total += end - from;
    cursor = Math.max(cursor, end);
  }
  return total;
}

function hours(minutes: number) {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

/**
 * The Day view's rail: what the day holds, as a stat pair (planned, free
 * within working hours) and one row per item in time order. Clicking a row
 * opens the item like clicking it on the grid.
 */
export default function DayRail({
  day,
  events,
  workingHours,
  onSelectEvent,
}: {
  day: Date;
  events: CalendarEvent[];
  workingHours: WorkingHours | null | undefined;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const items = useMemo(
    () => events.filter((event) => isSameDay(event.start, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime()),
    [events, day],
  );
  const window = useMemo(() => {
    const noon = new Date(day);
    noon.setHours(12, 0, 0, 0);
    const span = workdayWindow(workingHours, noon);
    return span ? { start: minutesOf(span.start), end: minutesOf(span.end) } : null;
  }, [day, workingHours]);
  const planned = items.filter((event) => !event.allDay).reduce((sum, event) => sum + event.durationMinutes, 0);
  const free = window ? Math.max(0, window.end - window.start - busyMinutes(items, window)) : null;
  const done = items.filter((event) => event.completedAt).length;

  return (
    <RailSection title="This day" meta={items.length ? `${done} of ${items.length} done` : undefined} data-testid="day-rail">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <RailStat value={hours(planned)} label="planned" />
        <RailStat value={free === null ? "–" : hours(free)} label={window ? "free in working hours" : "no working hours"} tone={free !== null && free > 0 ? "success" : "default"} />
      </div>
      {items.length === 0 ? (
        <RailEmpty>Nothing placed on this day. Click a slot on the grid to add something.</RailEmpty>
      ) : (
        <RailRows>
          {items.map((event) => (
            <RailRow
              key={event.id}
              label={event.title}
              color={swatchColor(event.color)}
              meta={event.allDay ? "All day" : `${event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${formatDuration(event.durationMinutes)}`}
              tone={event.completedAt ? "muted" : "default"}
              onClick={() => onSelectEvent(event)}
            />
          ))}
        </RailRows>
      )}
    </RailSection>
  );
}

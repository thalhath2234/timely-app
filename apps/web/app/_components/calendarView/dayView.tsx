"use client";

import TimeGrid from "./timeGrid";
import { startOfDay, type CalendarEvent } from "@/app/utils/calendar";

type DayViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
};

export default function DayView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
}: DayViewProps) {
  return (
    <TimeGrid
      days={[startOfDay(selectedDate)]}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
    />
  );
}

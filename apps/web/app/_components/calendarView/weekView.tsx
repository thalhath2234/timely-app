"use client";

import { useMemo } from "react";
import TimeGrid from "./timeGrid";
import { weekDays, type CalendarEvent } from "@/app/utils/calendar";

type WeekViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
};

export default function WeekView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
}: WeekViewProps) {
  const days = useMemo(() => weekDays(selectedDate), [selectedDate]);

  return (
    <TimeGrid
      days={days}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
    />
  );
}

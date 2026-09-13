"use client";

import TimeGrid from "./timeGrid";
import { startOfDay, type CalendarEvent } from "@/app/utils/calendar";

type DayViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (day: Date, hour: number, taskId: string) => void;
};

export default function DayView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
}: DayViewProps) {
  return (
    <TimeGrid
      days={[startOfDay(selectedDate)]}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
      onDropTask={onDropTask}
    />
  );
}

"use client";

import TimeGrid from "./timeGrid";
import { startOfDay, type CalendarEvent } from "@/app/utils/calendar";

type DayViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (at: Date, taskId: string) => void;
  onMoveBlock?: (event: CalendarEvent, start: Date, end: Date) => void;
};

export default function DayView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
  onMoveBlock,
}: DayViewProps) {
  return (
    <TimeGrid
      days={[startOfDay(selectedDate)]}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
      onDropTask={onDropTask}
      onMoveBlock={onMoveBlock}
    />
  );
}

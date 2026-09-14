"use client";

import { useMemo } from "react";
import TimeGrid from "./timeGrid";
import { weekDays, type CalendarEvent } from "@/app/utils/calendar";

type WeekViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (at: Date, taskId: string) => void;
  onMoveBlock?: (event: CalendarEvent, start: Date, end: Date) => void;
};

export default function WeekView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
  onMoveBlock,
}: WeekViewProps) {
  const days = useMemo(() => weekDays(selectedDate), [selectedDate]);

  return (
    <TimeGrid
      days={days}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
      onDropTask={onDropTask}
      onMoveBlock={onMoveBlock}
    />
  );
}

"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import TimeGrid from "./timeGrid";
import { startOfDay, type CalendarEvent } from "@/app/utils/calendar";

type DayViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (at: Date, taskId: string) => void;
  onMoveBlock?: (event: CalendarEvent, start: Date, end: Date) => void;
  onEventContextMenu?: (mouse: ReactMouseEvent, event: CalendarEvent) => void;
  onSlotContextMenu?: (mouse: ReactMouseEvent, day: Date, hour: number) => void;
};

export default function DayView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
  onMoveBlock,
  onEventContextMenu,
  onSlotContextMenu,
}: DayViewProps) {
  return (
    <TimeGrid
      days={[startOfDay(selectedDate)]}
      events={events}
      onSelectEvent={onSelectEvent}
      onSelectSlot={onSelectSlot}
      onDropTask={onDropTask}
      onMoveBlock={onMoveBlock}
      onEventContextMenu={onEventContextMenu}
      onSlotContextMenu={onSlotContextMenu}
    />
  );
}

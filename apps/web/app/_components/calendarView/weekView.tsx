"use client";

import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import TimeGrid from "./timeGrid";
import { weekDays, type CalendarEvent } from "@/app/utils/calendar";

type WeekViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (at: Date, taskId: string) => void;
  onMoveBlock?: (event: CalendarEvent, start: Date, end: Date) => void;
  onEventContextMenu?: (mouse: ReactMouseEvent, event: CalendarEvent) => void;
  onSlotContextMenu?: (mouse: ReactMouseEvent, day: Date, hour: number) => void;
};

export default function WeekView({
  selectedDate,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
  onMoveBlock,
  onEventContextMenu,
  onSlotContextMenu,
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
      onEventContextMenu={onEventContextMenu}
      onSlotContextMenu={onSlotContextMenu}
    />
  );
}

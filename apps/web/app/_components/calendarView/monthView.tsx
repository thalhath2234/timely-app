"use client";

import { useMemo } from "react";
import {
  eventsForDay,
  eventStyle,
  isSameDay,
  monthGrid,
  slotAt,
  type CalendarEvent,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import { dragHasTask, readTaskDragId } from "@/app/utils/taskDrag";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_DAY = 3;

type MonthViewProps = {
  selectedDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onOpenDay: (day: Date) => void;
  /** Empty-cell click schedules a task at 9:00 that day. */
  onSelectSlot?: (day: Date, hour: number) => void;
  onDropTask?: (at: Date, taskId: string) => void;
};

export default function MonthView({
  selectedDate,
  events,
  onSelectEvent,
  onOpenDay,
  onSelectSlot,
  onDropTask,
}: MonthViewProps) {
  const { days, rows } = useMemo(() => monthGrid(selectedDate), [selectedDate]);
  const today = new Date();

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted">
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      <div
        className="grid flex-1 grid-cols-7 overflow-auto"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(6rem, 1fr))` }}
      >
        {days.map((day) => {
          const inMonth = day.getMonth() === selectedDate.getMonth();
          const isToday = isSameDay(day, today);
          const dayEvents = eventsForDay(events, day);

          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSlot?.(day, 9)}
              onDragOver={(event) => {
                if (!onDropTask || !dragHasTask(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                if (!onDropTask) return;
                event.preventDefault();
                const taskId = readTaskDragId(event);
                if (taskId) onDropTask(slotAt(day, 9), taskId);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectSlot?.(day, 9);
                }
              }}
              className={cn(
                "flex min-h-24 cursor-pointer flex-col gap-1 border-b border-r border-border p-1.5 transition-colors hover:bg-accent/50 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/40",
                isToday && "bg-card",
              )}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDay(day);
                }}
                aria-label={`Open day view for ${day.toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}`}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                  isToday
                    ? "bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    : inMonth
                      ? "text-muted-foreground hover:bg-muted"
                      : "text-muted-foreground/50 hover:bg-muted",
                )}
              >
                {day.getDate()}
              </button>

              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onSelectEvent(event);
                    }}
                    style={eventStyle(event.color)}
                    className={cn(
                      "truncate rounded border px-1.5 py-0.5 text-left text-[10px] leading-tight text-foreground transition-all hover:brightness-110",
                      !inMonth && "opacity-60",
                    )}
                  >
                    {event.title}
                  </button>
                ))}

                {dayEvents.length > MAX_CHIPS_PER_DAY && (
                  <button
                    type="button"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onOpenDay(day);
                    }}
                    className="px-1 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    +{dayEvents.length - MAX_CHIPS_PER_DAY} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

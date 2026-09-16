"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bell } from "lucide-react";
import { formatHour, HOURS } from "@/app/_types/types";
import {
  dateOnDayAtMinutes,
  dragBlockInterval,
  eventsForDay,
  eventStyle,
  formatTime,
  HOUR_HEIGHT,
  isDraggableCalendarBlock,
  isSameDay,
  layoutDayEvents,
  mergeAdjacentTaskBlocks,
  REMINDER_HEIGHT,
  snapMinutes,
  type CalendarEvent,
  type GridDragMode,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";
import { dragHasTask, readTaskDragId } from "@/app/utils/taskDrag";

type TimeGridProps = {
  days: Date[];
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  /** Clicking an empty hour opens the schedule dialog for that slot. */
  onSelectSlot?: (day: Date, hour: number) => void;
  /** Drop a waiting-rail task onto the grid to pin it there. */
  onDropTask?: (at: Date, taskId: string) => void;
  /** Drag-move or edge-resize a scheduled work block. */
  onMoveBlock?: (event: CalendarEvent, start: Date, end: Date) => void;
  /** Right-click on a block. */
  onEventContextMenu?: (mouse: ReactMouseEvent, event: CalendarEvent) => void;
  /** Right-click on an empty hour. */
  onSlotContextMenu?: (mouse: ReactMouseEvent, day: Date, hour: number) => void;
};

const MIN_BLOCK_HEIGHT = 20;
const GRID_HEIGHT = HOURS.length * HOUR_HEIGHT;
const MINUTES_PER_DAY = 24 * 60;

type DragSession = {
  event: CalendarEvent;
  mode: GridDragMode;
  originDay: Date;
  originStart: Date;
  originEnd: Date;
  originStartMinutes: number;
  originEndMinutes: number;
  grabOffsetMinutes: number;
  originX: number;
  originY: number;
  moved: boolean;
  suppressClick: boolean;
  live: DragPreview;
};

type DragPreview = {
  event: CalendarEvent;
  dayIndex: number;
  start: Date;
  end: Date;
  startHour: number;
  endHour: number;
};

function hoursOf(start: Date, end: Date) {
  const startHour = (start.getHours() * 60 + start.getMinutes()) / 60;
  const endMinutes = isSameDay(start, end)
    ? end.getHours() * 60 + end.getMinutes()
    : MINUTES_PER_DAY;
  return { startHour, endHour: Math.max(startHour + 0.25, endMinutes / 60) };
}

/** Solid 1px rules — borders on tall scrolled columns fail to paint in Chromium. */
function HourLines({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute top-0 right-0", className)}
      style={{ height: GRID_HEIGHT }}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 bg-foreground/20"
          style={{ top: (hour + 1) * HOUR_HEIGHT - 1, height: 1 }}
        />
      ))}
    </div>
  );
}

export default function TimeGrid({
  days,
  events,
  onSelectEvent,
  onSelectSlot,
  onDropTask,
  onMoveBlock,
  onEventContextMenu,
  onSlotContextMenu,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const stopListeningRef = useRef<(() => void) | null>(null);
  const onMoveBlockRef = useRef(onMoveBlock);
  onMoveBlockRef.current = onMoveBlock;
  const [now, setNow] = useState(() => new Date());
  const [preview, setPreview] = useState<DragPreview | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const visibleEvents = useMemo(
    () =>
      days.map((day) =>
        layoutDayEvents(mergeAdjacentTaskBlocks(eventsForDay(events, day))),
      ),
    [days, events],
  );

  // A full 24-hour grid opens on midnight otherwise, which is rarely useful.
  const anchorKey = days[0]?.toDateString() ?? "";
  const focusHour = useMemo(() => {
    const starts = visibleEvents.flat().map((item) => item.event.startHour);
    return starts.length ? Math.min(...starts) : new Date().getHours();
  }, [visibleEvents]);
  const scrolledAnchor = useRef("");
  const scrolledWithEvents = useRef(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const hasEvents = visibleEvents.some((day) => day.length > 0);
    const rangeChanged = scrolledAnchor.current !== anchorKey;
    if (rangeChanged) scrolledWithEvents.current = false;
    const dataArrived = hasEvents && !scrolledWithEvents.current;
    scrolledAnchor.current = anchorKey;
    scrolledWithEvents.current = hasEvents;
    // Reorder refetches must not jump the scroll position under the pointer.
    if (!rangeChanged && !dataArrived) return;
    element.scrollTop = Math.max(0, (focusHour - 1) * HOUR_HEIGHT);
  }, [anchorKey, focusHour, visibleEvents]);

  const dayIndexFromX = (clientX: number) => {
    let nearest = 0;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < days.length; i += 1) {
      const rect = columnRefs.current[i]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX >= rect.left && clientX < rect.right) return i;
      const dist = clientX < rect.left ? rect.left - clientX : clientX - rect.right;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    return nearest;
  };

  const minutesFromY = (clientY: number) => {
    const rect =
      columnRefs.current.find((column) => column)?.getBoundingClientRect();
    if (!rect) return 0;
    return ((clientY - rect.top) / HOUR_HEIGHT) * 60;
  };

  const liveInterval = (session: DragSession, clientX: number, clientY: number) => {
    const dayIndex =
      session.mode === "move" ? dayIndexFromX(clientX) : days.findIndex((day) => isSameDay(day, session.originDay));
    const day = days[Math.max(0, dayIndex)] ?? session.originDay;
    const interval = dragBlockInterval({
      mode: session.mode,
      day,
      pointerMinutes: minutesFromY(clientY),
      grabOffsetMinutes: session.grabOffsetMinutes,
      originStartMinutes: session.originStartMinutes,
      originEndMinutes: session.originEndMinutes,
    });
    const hours = hoursOf(interval.start, interval.end);
    return {
      event: session.event,
      dayIndex: Math.max(0, dayIndex),
      start: interval.start,
      end: interval.end,
      ...hours,
    };
  };
  const liveIntervalRef = useRef(liveInterval);
  liveIntervalRef.current = liveInterval;

  const startDrag = (
    event: CalendarEvent,
    day: Date,
    mode: GridDragMode,
    pointer: ReactPointerEvent,
  ) => {
    if (!onMoveBlock || !isDraggableCalendarBlock(event) || pointer.button !== 0) return;
    pointer.stopPropagation();
    dragRef.current = null;
    setPreview(null);
    stopListeningRef.current?.();
    const startMinutes = Math.round(event.startHour * 60);
    const endMinutes = Math.round(event.endHour * 60);
    const grabOffsetMinutes = minutesFromY(pointer.clientY) - startMinutes;
    const live: DragPreview = {
      event,
      dayIndex: Math.max(0, days.findIndex((item) => isSameDay(item, day))),
      start: event.start,
      end: event.end,
      startHour: event.startHour,
      endHour: event.endHour,
    };
    dragRef.current = {
      event,
      mode,
      originDay: day,
      originStart: event.start,
      originEnd: event.end,
      originStartMinutes: startMinutes,
      originEndMinutes: endMinutes,
      grabOffsetMinutes,
      originX: pointer.clientX,
      originY: pointer.clientY,
      moved: false,
      suppressClick: mode !== "move",
      live,
    };

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (nextPointer: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      const next = liveIntervalRef.current(
        session,
        nextPointer.clientX,
        nextPointer.clientY,
      );
      const dragged =
        Math.hypot(nextPointer.clientX - session.originX, nextPointer.clientY - session.originY) > 5;
      session.moved = session.moved || dragged;
      session.live = next;
      if (!session.moved) return;
      document.body.style.cursor = session.mode === "move" ? "grabbing" : "ns-resize";
      setPreview((prev) => {
        if (
          prev &&
          prev.dayIndex === next.dayIndex &&
          prev.start.getTime() === next.start.getTime() &&
          prev.end.getTime() === next.end.getTime()
        ) {
          return prev;
        }
        return next;
      });
    };

    const stopListening = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      stopListeningRef.current = null;
    };

    const finish = () => {
      const session = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      stopListening();
      if (!session) return;
      if (session.suppressClick || session.moved) suppressClickRef.current = true;
      if (!session.moved) return;
      const liveEnd = session.live;
      const unchanged =
        liveEnd.start.getTime() === session.originStart.getTime() &&
        liveEnd.end.getTime() === session.originEnd.getTime();
      if (unchanged) return;
      onMoveBlockRef.current?.(session.event, liveEnd.start, liveEnd.end);
    };

    const onKey = (keyboard: KeyboardEvent) => {
      if (keyboard.key !== "Escape") return;
      suppressClickRef.current = true;
      dragRef.current = null;
      setPreview(null);
      stopListening();
    };

    stopListeningRef.current = stopListening;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("keydown", onKey);
  };

  useEffect(() => () => stopListeningRef.current?.(), []);

  const nowHour = now.getHours() + now.getMinutes() / 60;
  const guidelineHour =
    preview && dragRef.current
      ? dragRef.current.mode === "resize-end"
        ? preview.endHour
        : preview.startHour
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 border-b border-border">
        <div className="w-14 shrink-0 border-r border-border" />
        {days.map((day) => {
          const isToday = isSameDay(day, now);
          return (
            <div
              key={`head-${day.toISOString()}`}
              className={cn(
                "flex h-10 min-w-32 flex-1 items-center justify-center gap-1.5 border-r border-border text-sm last:border-r-0",
                isToday ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {day.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
              })}
              {isToday && <span className="size-1.5 rounded-full bg-primary" />}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ height: GRID_HEIGHT, minHeight: GRID_HEIGHT }}>
          <HourLines className="left-14 z-0" />

          <div className="relative w-14 shrink-0 border-r border-border">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-2 z-[2] text-[10px] tabular-nums text-muted-foreground">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const isToday = isSameDay(day, now);
            const columnPreview =
              preview && preview.dayIndex === dayIndex ? preview : null;

            return (
              <div
                key={day.toISOString()}
                ref={(node) => {
                  columnRefs.current[dayIndex] = node;
                }}
                className="relative min-w-32 flex-1 border-r border-border last:border-r-0"
                style={{ height: GRID_HEIGHT }}
                onDragOver={(event) => {
                  if (!onDropTask || !dragHasTask(event)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  if (!onDropTask) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const taskId = readTaskDragId(event);
                  if (!taskId) return;
                  const top = event.currentTarget.getBoundingClientRect().top;
                  const minutes = Math.max(
                    0,
                    Math.min(
                      MINUTES_PER_DAY - 15,
                      snapMinutes(((event.clientY - top) / HOUR_HEIGHT) * 60),
                    ),
                  );
                  onDropTask(dateOnDayAtMinutes(day, minutes), taskId);
                }}
              >
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`Schedule at ${formatHour(hour)} on ${day.toLocaleDateString()}`}
                    onClick={() => {
                      if (preview) return;
                      onSelectSlot?.(day, hour);
                    }}
                    onContextMenu={(mouse) => onSlotContextMenu?.(mouse, day, hour)}
                    onDragOver={(event) => {
                      if (!onDropTask || !dragHasTask(event)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(event) => {
                      if (!onDropTask) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const taskId = readTaskDragId(event);
                      if (!taskId) return;
                      const column = event.currentTarget.parentElement;
                      if (!column) return;
                      const top = column.getBoundingClientRect().top;
                      const minutes = Math.max(
                        0,
                        Math.min(
                          MINUTES_PER_DAY - 15,
                          snapMinutes(((event.clientY - top) / HOUR_HEIGHT) * 60),
                        ),
                      );
                      onDropTask(dateOnDayAtMinutes(day, minutes), taskId);
                    }}
                    className={cn(
                      "block w-full bg-transparent",
                      preview
                        ? "pointer-events-none"
                        : "transition-colors hover:bg-accent/30",
                    )}
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}

                {isToday && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 h-0"
                    style={{ top: nowHour * HOUR_HEIGHT }}
                    aria-hidden="true"
                  >
                    <span className="absolute top-0 size-2 -translate-x-1 -translate-y-1/2 rounded-full bg-destructive" />
                    <span className="absolute top-0 left-0 right-0 h-px -translate-y-1/2 bg-destructive" />
                  </div>
                )}

                {guidelineHour != null && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 h-px bg-primary"
                    style={{ top: guidelineHour * HOUR_HEIGHT }}
                    aria-hidden
                  />
                )}

                {visibleEvents[dayIndex].map(
                  ({ event, lane, lanes, reminderOverTask, reminderLiftHours }) => {
                    if (event.reminder) {
                      const liftPx = (reminderLiftHours ?? 0) * HOUR_HEIGHT;
                      return (
                        <button
                          key={event.id}
                          type="button"
                          title={event.title}
                          onClick={() => onSelectEvent(event)}
                          onContextMenu={(mouse) => onEventContextMenu?.(mouse, event)}
                          style={{
                            top:
                              event.startHour * HOUR_HEIGHT - REMINDER_HEIGHT - liftPx,
                            height: REMINDER_HEIGHT,
                            ...eventStyle(event.color),
                          }}
                          className={cn(
                            "absolute z-[3] flex items-center gap-1 overflow-hidden rounded-full border bg-card px-2 text-left text-foreground shadow-sm hover:z-[6] hover:shadow-md hover:brightness-110",
                            reminderOverTask
                              ? "right-[4px] left-auto w-[min(12.5rem,50%)] max-w-[calc(100%-8px)] hover:w-[calc(100%-8px)]"
                              : "left-[2px] right-[2px] w-auto",
                            preview && "pointer-events-none",
                          )}
                        >
                          <Bell className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate text-xs font-medium leading-none">
                            {event.title}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {formatTime(event.start)}
                          </span>
                        </button>
                      );
                    }

                    const height = Math.max(
                      (event.endHour - event.startHour) * HOUR_HEIGHT - 2,
                      MIN_BLOCK_HEIGHT,
                    );
                    const draggable = Boolean(onMoveBlock) && isDraggableCalendarBlock(event);
                    const isSource = preview?.event.id === event.id;
                    const left = `calc(${(lane * 100) / lanes}% + 2px)`;
                    const width = `calc(${100 / lanes}% - 4px)`;

                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          onSelectEvent(event);
                        }}
                        onContextMenu={(mouse) => onEventContextMenu?.(mouse, event)}
                        onPointerDown={(pointer) => startDrag(event, day, "move", pointer)}
                        style={{
                          top: event.startHour * HOUR_HEIGHT,
                          height,
                          left,
                          width,
                          ...eventStyle(event.color),
                        }}
                        className={cn(
                          "group absolute z-[2] flex flex-col overflow-hidden rounded-md border bg-card px-2 py-1 text-left text-foreground hover:z-[3] hover:shadow-md hover:brightness-110",
                          draggable && "cursor-grab touch-none",
                          isSource && "opacity-40",
                          (preview || isSource) && "pointer-events-none",
                        )}
                      >
                        <span className="truncate text-xs font-medium leading-tight">
                          {event.title}
                        </span>
                        {height > 36 ? (
                          <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                            {formatTime(event.start)} – {formatTime(event.end)}
                          </span>
                        ) : null}
                        {draggable ? (
                          <>
                            <span
                              role="separator"
                              aria-label={`Resize start of ${event.title}`}
                              onPointerDown={(pointer) => {
                                pointer.preventDefault();
                                startDrag(event, day, "resize-start", pointer);
                              }}
                              className="absolute inset-x-0 top-0 z-[1] h-2 cursor-ns-resize group-hover:bg-foreground/15"
                            />
                            <span
                              role="separator"
                              aria-label={`Resize end of ${event.title}`}
                              onPointerDown={(pointer) => {
                                pointer.preventDefault();
                                startDrag(event, day, "resize-end", pointer);
                              }}
                              className="absolute inset-x-0 bottom-0 z-[1] h-2 cursor-ns-resize group-hover:bg-foreground/15"
                            />
                          </>
                        ) : null}
                      </button>
                    );
                  },
                )}

                {columnPreview ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-30 flex flex-col overflow-hidden rounded-md border border-primary px-2 py-1 text-left shadow-lg"
                    style={{
                      top: columnPreview.startHour * HOUR_HEIGHT,
                      height: Math.max(
                        (columnPreview.endHour - columnPreview.startHour) * HOUR_HEIGHT - 2,
                        MIN_BLOCK_HEIGHT,
                      ),
                      left: 2,
                      right: 2,
                      ...eventStyle(columnPreview.event.color),
                    }}
                  >
                    <span className="truncate text-xs font-medium leading-tight">
                      {columnPreview.event.title}
                    </span>
                    <span className="truncate text-[10px] tabular-nums text-muted-foreground">
                      {formatTime(columnPreview.start)} – {formatTime(columnPreview.end)}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import MonthView from "@/app/_components/calendarView/monthView";
import WeekView from "@/app/_components/calendarView/weekView";
import DayView from "@/app/_components/calendarView/dayView";
import AgendaView from "@/app/_components/calendarView/agendaView";
import EventDialog from "@/app/_components/calendarView/eventDialog";
import ScheduleDialog, {
  isUnscheduled,
  type ScheduleSlot,
} from "@/app/_components/calendarView/scheduleDialog";
import AutoScheduleDialog from "@/app/_components/calendarView/autoScheduleDialog";
import EntityDetailPanel from "@/app/_components/_ui/tasks/entityDetailPanel";

import { CALENDAR_VIEWS, CalendarView, Task } from "@/app/_types/types";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useCalendarRange } from "@/app/utils/hooks/calendar";
import {
  eventLegend,
  headerLabel,
  isSameDay,
  shiftDate,
  slotAt,
  swatchColor,
  toCalendarEvents,
  viewRange,
  type CalendarEvent,
} from "@/app/utils/calendar";
import { cn } from "@/app/utils/cn";

function CalendarContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = searchParams.get("view") as CalendarView | null;

  const { activeView, setActiveView, selectedDate, setSelectedDate } =
    useCalendarStore();

  const { data: tasks } = useTasks();
  const range = useMemo(
    () => viewRange(selectedDate, activeView),
    [selectedDate, activeView],
  );
  const {
    data: calendar,
    isLoading,
    status,
  } = useCalendarRange(range.from, range.to);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [scheduleSlot, setScheduleSlot] = useState<ScheduleSlot | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const typedTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const events = useMemo(
    () => toCalendarEvents(calendar?.items ?? []),
    [calendar],
  );
  const legend = useMemo(() => eventLegend(events), [events]);
  const unscheduledCount = useMemo(
    () => typedTasks.filter(isUnscheduled).length,
    [typedTasks],
  );

  // Selection is held by id so a refetch shows fresh data in the dialog, and
  // a block or occurrence that disappeared simply closes it.
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const setSelectedEvent = useCallback(
    (event: CalendarEvent | null) => setSelectedEventId(event?.id ?? null),
    [],
  );

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);

      return params.toString();
    },
    [searchParams],
  );

  useEffect(() => {
    if (view && view !== activeView) setActiveView(view);
  }, [view, activeView, setActiveView]);

  const goToView = (next: CalendarView) => {
    setActiveView(next);
    router.push(pathname + "?" + createQueryString("view", next));
  };

  const openDay = (day: Date) => {
    setSelectedDate(day, 0);
    goToView("day");
  };

  const openScheduleSlot = (day: Date, hour: number) => {
    setScheduleSlot({ at: slotAt(day, hour), durationMinutes: 30 });
  };

  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    setClock(new Date());
  }, []);
  const isToday = clock != null && isSameDay(selectedDate, clock);

  return (
    <main className="flex h-full flex-col gap-4 overflow-hidden bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous period"
              onClick={() =>
                setSelectedDate(shiftDate(selectedDate, activeView, -1), -1)
              }
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>

            <span
              suppressHydrationWarning
              className="min-w-40 text-center text-sm font-medium"
            >
              {headerLabel(selectedDate, activeView)}
            </span>

            <button
              type="button"
              aria-label="Next period"
              onClick={() =>
                setSelectedDate(shiftDate(selectedDate, activeView, 1), 1)
              }
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>

            <button
              type="button"
              disabled={isToday}
              onClick={() => setSelectedDate(new Date(), 0)}
              className="h-7 rounded-lg border border-border bg-input/30 px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
            >
              Today
            </button>
          </div>
        </div>

        <div className="flex w-fit items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Sparkles className="size-3.5" />
            Auto-schedule
            {unscheduledCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {unscheduledCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setScheduleSlot({
                at: slotAt(selectedDate, 9),
                durationMinutes: 30,
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <CalendarPlus className="size-3.5" />
            Add
          </button>

          <div className="flex items-center gap-0.5">
            {CALENDAR_VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={activeView === option.value}
                onClick={() => goToView(option.value)}
                className={cn(
                  "h-8 min-w-8 rounded-lg border border-input px-2.5 text-sm font-medium transition-all",
                  activeView === option.value
                    ? "bg-muted text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(legend.length > 0 || events.length === 0) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: swatchColor(entry.color) }}
              />
              {entry.label}
            </span>
          ))}

          <span className="ml-auto tabular-nums">
            {events.length} on calendar
            {unscheduledCount > 0
              ? ` · ${unscheduledCount} waiting`
              : ""}
          </span>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          Loading calendar...
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card text-sm text-destructive">
          Could not load the calendar.
        </div>
      )}

      {!isLoading && status !== "error" && (
        <>
          {events.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Nothing in this period. Click an empty slot to place a task or
              add an event, or let Auto-schedule fill your working hours.
              Deadlines alone do not appear here.
            </div>
          )}

          {activeView === "day" && (
            <DayView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onSelectSlot={openScheduleSlot}
            />
          )}

          {activeView === "week" && (
            <WeekView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onSelectSlot={openScheduleSlot}
            />
          )}

          {activeView === "month" && (
            <MonthView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onOpenDay={openDay}
              onSelectSlot={openScheduleSlot}
            />
          )}

          {activeView === "agenda" && (
            <AgendaView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
            />
          )}
        </>
      )}

      <EventDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onOpenTask={(taskId) => {
          setSelectedEvent(null);
          setDetailTaskId(taskId);
        }}
      />

      <ScheduleDialog
        slot={scheduleSlot}
        tasks={typedTasks}
        onClose={() => setScheduleSlot(null)}
      />

      <AutoScheduleDialog
        open={autoOpen}
        onClose={() => setAutoOpen(false)}
        onOpenSettings={() => {
          setAutoOpen(false);
          router.push("/settings?tab=schedule");
        }}
      />

      {detailTaskId && (
        <EntityDetailPanel
          kind="task"
          id={detailTaskId}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </main>
  );
}

export default function Calendar() {
  return (
    <Suspense
      fallback={
        <div className="p-5 text-muted-foreground">Loading calendar...</div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}

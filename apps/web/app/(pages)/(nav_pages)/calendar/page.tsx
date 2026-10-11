"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const subscribeNoop = () => () => {};

import MonthView from "@/app/_components/calendarView/monthView";
import WeekView from "@/app/_components/calendarView/weekView";
import DayView from "@/app/_components/calendarView/dayView";
import AgendaView from "@/app/_components/calendarView/agendaView";
import EventDialog from "@/app/_components/calendarView/eventDialog";
import ScheduleDialog, {
  type ScheduleSlot,
} from "@/app/_components/calendarView/scheduleDialog";
import AutoScheduleDialog from "@/app/_components/calendarView/autoScheduleDialog";
import WaitingForSlotRail from "@/app/_components/calendarView/waitingForSlotRail";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";

import { CALENDAR_VIEWS, CalendarView, Task } from "@/app/_types/types";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import LoadError from "@/app/_components/_ui/loadError";
import { useTasks } from "@/app/utils/hooks/tasks";
import { runViewTransition } from "@/app/utils/viewTransition";
import { useAddTaskBlock, useCalendarRange, useCommitCalendarBlock, useApplySchedule, useWaitingForSlot } from "@/app/utils/hooks/calendar";
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
import { useWorkingHoursZone } from "@/app/utils/hooks/workspaces";
import { markDeadlinePassed, overdueAgendaTasks, taskToCalendarItem } from "@/app/utils/overdue";
import { cn } from "@/app/utils/cn";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useCalendarContextMenu } from "@/app/utils/hooks/useCalendarContextMenu";
import { AnimatePresence, motion } from "motion/react";
import { fadeTransition } from "@/app/_components/_ui/motion";
import ScreenTip from "@/app/_components/_ui/screenTip";
import Button from "@/app/_components/_ui/button";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";

function CalendarContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = searchParams.get("view") as CalendarView | null;

  const { activeView, setActiveView, selectedDate, setSelectedDate } =
    useCalendarStore();
  const scheduleStatus = useScheduleActivityStore((state) => state.status);

  const { data: tasks } = useTasks();
  const range = useMemo(
    () => viewRange(selectedDate, activeView),
    [selectedDate, activeView],
  );
  const calendarQuery = useCalendarRange(range.from, range.to);
  const rankQuery = useWaitingForSlot();
  const { data: calendar, isLoading, status } = calendarQuery;

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [scheduleSlot, setScheduleSlot] = useState<ScheduleSlot | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [scopedTaskIds, setScopedTaskIds] = useState<string[] | undefined>(undefined);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const addBlock = useAddTaskBlock();
  const commitBlock = useCommitCalendarBlock();
  const applySchedule = useApplySchedule();

  const timeZone = useWorkingHoursZone();
  const typedTasks = useMemo(() => (tasks ?? []) as Task[], [tasks]);
  const events = useMemo(
    () => markDeadlinePassed(toCalendarEvents(calendar?.items ?? []), timeZone),
    [calendar, timeZone],
  );
  const overdueEvents = useMemo(
    () => toCalendarEvents(overdueAgendaTasks(typedTasks, timeZone).map(taskToCalendarItem)),
    [typedTasks, timeZone],
  );
  const legend = useMemo(() => eventLegend(events), [events]);
  const unscheduledCount = rankQuery.data?.length ?? 0;

  // Selection is held by id so a refetch shows fresh data in the dialog, and
  // a block or occurrence that disappeared simply closes it.
  const selectedEvent = useMemo(
    () =>
      events.find((event) => event.id === selectedEventId) ??
      overdueEvents.find((event) => event.id === selectedEventId) ??
      null,
    [events, overdueEvents, selectedEventId],
  );
  const setSelectedEvent = useCallback(
    (event: CalendarEvent | null) => {
      runViewTransition(() => setSelectedEventId(event?.id ?? null));
    },
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
    runViewTransition(() =>
      setScheduleSlot({ at: slotAt(day, hour), durationMinutes: 30 }),
    );
  };

  const openAutoSchedule = (taskIds?: string[]) => {
    runViewTransition(() => {
      setScopedTaskIds(taskIds);
      setAutoOpen(true);
    });
  };

  const rerunAroundPins = useCallback(async () => {
    const activity = useScheduleActivityStore.getState();
    activity.start();
    try {
      const plan = await applySchedule.mutateAsync({ includeManual: false });
      activity.finish(plan);
    } catch (err) {
      activity.fail(
        err instanceof Error ? err.message : "Could not update schedule.",
      );
    }
  }, [applySchedule]);

  const dropTaskOnSlot = useCallback(
    (at: Date, taskId: string) => {
      const task = typedTasks.find((item) => item.id === taskId);
      const minutes = Math.max(task?.duration || 0, 30);
      void (async () => {
        try {
          await addBlock.mutateAsync({
            taskId,
            start: at.toISOString(),
            durationMinutes: minutes,
            replace: true,
          });
          await rerunAroundPins();
        } catch (err) {
          useScheduleActivityStore.getState().fail(
            err instanceof Error ? err.message : "Could not place task.",
          );
        }
      })();
    },
    [addBlock, rerunAroundPins, typedTasks],
  );

  const moveCalendarBlock = useCallback(
    (event: CalendarEvent, start: Date, end: Date) => {
      if (!event.blockId) return;
      void commitBlock.mutateAsync({
        blockId: event.blockId,
        extraBlockIds: event.blockIds ?? [],
        start,
        end,
      }).catch((err) => {
        useScheduleActivityStore.getState().fail(
          err instanceof Error ? err.message : "Could not move block.",
        );
      });
    },
    [commitBlock],
  );

  const openMenu = useContextMenu();
  const { eventMenu, slotMenu } = useCalendarContextMenu({
    onOpenEvent: setSelectedEvent,
    onSelectSlot: openScheduleSlot,
    onAutoSchedule: openAutoSchedule,
    onOpenDay: openDay,
  });

  const onEventContextMenu = (mouse: React.MouseEvent, event: CalendarEvent) =>
    openMenu(mouse, eventMenu(event), { title: event.title });

  const onSlotContextMenu = (mouse: React.MouseEvent, day: Date, hour: number) =>
    openMenu(mouse, slotMenu(day, hour));

  // Server render has no "today"; the client snapshot fills it in after
  // hydration without a setState-in-effect round trip.
  const todayStamp = useSyncExternalStore(
    subscribeNoop,
    () => new Date().toDateString(),
    () => null,
  );
  const isToday = todayStamp != null && isSameDay(selectedDate, new Date(todayStamp));

  return (
    <main className="flex h-full flex-col gap-4 overflow-hidden bg-background px-6 pb-4 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Previous period"
              onClick={() =>
                setSelectedDate(shiftDate(selectedDate, activeView, -1), -1)
              }
            >
              <ChevronLeft />
            </Button>

            <span
              suppressHydrationWarning
              className="min-w-40 text-center text-sm font-medium"
            >
              {headerLabel(selectedDate, activeView)}
            </span>

            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Next period"
              onClick={() =>
                setSelectedDate(shiftDate(selectedDate, activeView, 1), 1)
              }
            >
              <ChevronRight />
            </Button>

            <Button
              variant="outline"
              size="sm"
              aria-current={isToday ? "date" : undefined}
              onClick={() => {
                if (!isToday) setSelectedDate(new Date(), 0);
              }}
            >
              Today
            </Button>
          </div>
        </div>

        <div className="flex w-fit items-center gap-2">
          <Button variant="outline" onClick={() => openAutoSchedule()}>
            <Sparkles
              className={cn(scheduleStatus === "running" && "animate-pulse text-primary")}
            />
            {scheduleStatus === "running" ? "Scheduling…" : "Auto-schedule"}
            {unscheduledCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {unscheduledCount}
              </span>
            )}
          </Button>

          <Button
            leading={<CalendarPlus />}
            onClick={() =>
              runViewTransition(() =>
                setScheduleSlot({
                  at: slotAt(selectedDate, 9),
                  durationMinutes: 30,
                }),
              )
            }
          >
            Add
          </Button>

          <SegmentedControl
            aria-label="Calendar view"
            value={activeView}
            onChange={goToView}
            options={CALENDAR_VIEWS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </div>
      </div>

      <ScreenTip screen="calendar" />

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
        <LoadError
          what="this calendar range"
          error={calendarQuery.error}
          onRetry={() => calendarQuery.refetch()}
          retrying={calendarQuery.isFetching}
        />
      )}

      {!isLoading && status !== "error" && (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          {events.length === 0 && overdueEvents.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Nothing in this period. Click an empty slot to place a task or
              add an event, or let Auto-schedule fill your working hours.
              Deadlines alone do not appear here.
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeView}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fadeTransition}
            >
          {activeView === "day" && (
            <DayView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onSelectSlot={openScheduleSlot}
              onDropTask={dropTaskOnSlot}
              onMoveBlock={moveCalendarBlock}
              onEventContextMenu={onEventContextMenu}
              onSlotContextMenu={onSlotContextMenu}
            />
          )}

          {activeView === "week" && (
            <WeekView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onSelectSlot={openScheduleSlot}
              onDropTask={dropTaskOnSlot}
              onMoveBlock={moveCalendarBlock}
              onEventContextMenu={onEventContextMenu}
              onSlotContextMenu={onSlotContextMenu}
            />
          )}

          {activeView === "month" && (
            <MonthView
              selectedDate={selectedDate}
              events={events}
              onSelectEvent={setSelectedEvent}
              onOpenDay={openDay}
              onSelectSlot={openScheduleSlot}
              onDropTask={dropTaskOnSlot}
              onEventContextMenu={onEventContextMenu}
              onSlotContextMenu={onSlotContextMenu}
            />
          )}

          {activeView === "agenda" && (
            <AgendaView
              selectedDate={selectedDate}
              events={events}
              overdueEvents={overdueEvents}
              onSelectEvent={setSelectedEvent}
              onEventContextMenu={onEventContextMenu}
            />
          )}
            </motion.div>
          </AnimatePresence>
          </div>
          <WaitingForSlotRail
            onOpen={(taskId) => openTask(taskId)}
            onSchedule={(taskId) => openAutoSchedule([taskId])}
          />
        </div>
      )}

      <EventDialog
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onOpenTask={(taskId) => {
          runViewTransition(() => {
            setSelectedEventId(null);
            openTask(taskId);
          });
        }}
      />

      <ScheduleDialog
        slot={scheduleSlot}
        tasks={typedTasks}
        onClose={() => runViewTransition(() => setScheduleSlot(null))}
      />

      <AutoScheduleDialog
        open={autoOpen}
        taskIds={scopedTaskIds}
        onClose={() => {
          runViewTransition(() => {
            setAutoOpen(false);
            setScopedTaskIds(undefined);
          });
        }}
        onOpenSettings={() => {
          runViewTransition(() => {
            setAutoOpen(false);
            setScopedTaskIds(undefined);
          });
          router.push("/settings?tab=schedule");
        }}
      />

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

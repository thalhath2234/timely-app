"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import SegmentedControl from "@/app/_components/mobile/SegmentedControl";
import DateStrip from "@/app/_components/mobile/calendar/DateStrip";
import MobileAgenda from "@/app/_components/mobile/calendar/MobileAgenda";
import MobileDay from "@/app/_components/mobile/calendar/MobileDay";
import MobileMonth from "@/app/_components/mobile/calendar/MobileMonth";
import CalendarItemSheet from "@/app/_components/mobile/calendar/CalendarItemSheet";
import {
  useMobileBlockScheduler,
  useMobileCalendar,
  useMobileTaskSaver,
} from "@/app/_lib/mobile/useMobileData";
import {
  addDays,
  dayKey,
  formatMonthYear,
  isSameDay,
  startOfDay,
} from "@/app/_lib/mobile/format";
import type { CalendarItem } from "@/app/_types/types";

type View = "day" | "agenda" | "month";

const VIEWS: { label: string; value: View }[] = [
  { label: "Day", value: "day" },
  { label: "Agenda", value: "agenda" },
  { label: "Month", value: "month" },
];

export default function MobileCalendarPage() {
  const [view, setView] = useState<View>("agenda");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<CalendarItem | null>(null);

  // Range covers the whole visible month grid (6 weeks) so every view shares
  // one query, and the agenda has two weeks of lookahead from the selection.
  const { from, to } = useMemo(() => {
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(gridStart, 42);
    const agendaEnd = addDays(selected, 21);
    return {
      from: gridStart < addDays(selected, -7) ? gridStart : addDays(selected, -7),
      to: gridEnd > agendaEnd ? gridEnd : agendaEnd,
    };
  }, [selected]);

  const { data: items, isDemo } = useMobileCalendar(from, to);
  const save = useMobileTaskSaver(isDemo);
  const scheduler = useMobileBlockScheduler(isDemo);

  function reschedule(item: CalendarItem, start: Date) {
    const duration = new Date(item.end).getTime() - new Date(item.start).getTime();
    if (item.kind === "task" && item.blockId) {
      void scheduler.moveBlock(item.blockId, start, duration);
    } else if (item.kind === "event" && item.event) {
      void scheduler.moveEvent(item.event.id, start, new Date(start.getTime() + duration));
    }
  }

  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(dayKey(startOfDay(new Date(item.start))));
    return set;
  }, [items]);

  const dayItems = useMemo(
    () => items.filter((i) => isSameDay(new Date(i.start), selected)),
    [items, selected],
  );

  const isToday = isSameDay(selected, new Date());

  function toggleComplete(item: CalendarItem) {
    if (!item.taskId) return;
    save(item.taskId, {
      completedAt: item.completedAt ? null : new Date().toISOString(),
    });
    setOpen(null);
  }

  function step(dir: -1 | 1) {
    if (view === "month") {
      setSelected(new Date(selected.getFullYear(), selected.getMonth() + dir, 1));
    } else {
      setSelected(addDays(selected, dir * (view === "day" ? 1 : 7)));
    }
  }

  return (
    <>
      <MobileHeader
        title={formatMonthYear(selected)}
        isDemo={isDemo}
        actions={
          <>
            <HeaderIconButton label="Previous" onClick={() => step(-1)}>
              <ChevronLeft size={22} />
            </HeaderIconButton>
            <HeaderIconButton label="Next" onClick={() => step(1)}>
              <ChevronRight size={22} />
            </HeaderIconButton>
            <button
              type="button"
              onClick={() => setSelected(startOfDay(new Date()))}
              disabled={isToday}
              className="mr-1 h-8 rounded-full border border-border px-3 text-[13px] font-medium text-foreground disabled:opacity-40"
            >
              Today
            </button>
          </>
        }
      >
        <div className="px-3 pb-3">
          <SegmentedControl options={VIEWS} value={view} onChange={setView} label="Calendar view" />
        </div>
        {view !== "month" ? (
          <DateStrip selected={selected} onSelect={setSelected} busyDays={busyDays} />
        ) : null}
      </MobileHeader>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "agenda" ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-28">
            <MobileAgenda items={items} from={selected} onOpen={setOpen} />
          </div>
        ) : null}
        {view === "day" ? <MobileDay date={selected} items={dayItems} onOpen={setOpen} /> : null}
        {view === "month" ? (
          <MobileMonth
            month={selected}
            selected={selected}
            onSelect={setSelected}
            items={items}
            onOpen={setOpen}
          />
        ) : null}
      </main>

      <CalendarItemSheet
        item={open}
        onClose={() => setOpen(null)}
        onToggleComplete={toggleComplete}
        onReschedule={reschedule}
      />
    </>
  );
}

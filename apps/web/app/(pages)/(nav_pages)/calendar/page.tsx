"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";

import MonthView from "@/app/_components/calendarView/monthView";
import WeekView from "@/app/_components/calendarView/weekView";
import DayView from "@/app/_components/calendarView/dayView";
import { CalendarView } from "@/app/_types/types";

import { useCalendarStore } from "@/app/_store/calendarStore";

const ViewOptions: { label: string; value: CalendarView }[] = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
  { label: "Day", value: "day" },
];

function CalendarContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = searchParams.get("view") as CalendarView;
  const {
    activeView,
    setActiveView,
    currentDate,
    setCurrentDate,
    selectedDate,
    setSelectedDate,
  } = useCalendarStore();

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);

      return params.toString();
    },
    [searchParams],
  );

  useEffect(() => {
    if (view && view !== activeView) setActiveView(view as CalendarView);
  }, [view]);

  function shift(date: Date, view: CalendarView, dir: 1 | -1) {
    const d = new Date(date);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    if (view === "week") d.setDate(d.getDate() + 7 * dir);
    if (view === "day") d.setDate(d.getDate() + dir);
    setSelectedDate(d, dir);
  }

  return (
    <div className="w-full h-full p-1 flex-none flex flex-col">
      <div className="flex w-full h-auto border-b border-white/10 py-3 px-5 justify-between">
        <div className="flex items-center gap-2">
          <motion.button
            className="bg-slate-700 h-7 px-2 text-sm rounded-md border-none cursor-pointer"
            onClick={() => setSelectedDate(new Date(), 0)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Today
          </motion.button>
          <motion.button
            className="h-7 px-2 text-sm rounded-md border-none cursor-pointer hover:bg-slate-600"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => shift(selectedDate, activeView, -1)}
          >
            <ChevronLeft className="color-white size-4" />
          </motion.button>
          <motion.button
            className="h-7 px-2 text-sm rounded-md border-none cursor-pointer  hover:bg-slate-600"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => shift(selectedDate, activeView, 1)}
          >
            <ChevronRight className="color-white size-4" />
          </motion.button>
          <b className="text-m">
            {activeView === "day"
              ? selectedDate.toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : activeView === "week"
                ? selectedDate.toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })
                : selectedDate.toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
          </b>
        </div>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            <motion.div
              className="flex flex-row mt-2 w-full rounded-md bg-slate-700 backdrop-blur shadow-lg"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{
                duration: 0.1,
                type: "spring",
                stiffness: 400,
                damping: 32,
              }}
            >
              {ViewOptions.map((view) => (
                <button
                  key={view.value}
                  type="button"
                  onClick={() => {
                    setActiveView(view.value);

                    router.push(
                      pathname + "?" + createQueryString("view", view.value),
                    );
                  }}
                  className="relative w-full px-2 py-1 h-7 text-sm "
                >
                  {activeView === view.value && (
                    <motion.div
                      layoutId="calendar-active-view-pill"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 32,
                      }}
                      className="absolute inset-0 rounded-md bg-white z-0"
                    />
                  )}

                  <span
                    className={`relative z-10 capitalize ${activeView == view.value ? " text-tertiary" : " text-white"}`}
                  >
                    {view.label}
                  </span>
                </button>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="flex-1 w-full h-full">
        <AnimatePresence>
          {activeView === "month" && <MonthView />}
          {activeView === "week" && <WeekView />}
          {activeView === "day" && <DayView />}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Calendar() {
  return (
    <Suspense
      fallback={<div className="p-5 text-white">Loading calendar...</div>}
    >
      <CalendarContent />
    </Suspense>
  );
}

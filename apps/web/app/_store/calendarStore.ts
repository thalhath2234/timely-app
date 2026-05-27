"use client";

import { create } from "zustand";
import { CalendarView } from "../_types/types";

type CalendarState = {
  direction: 1 | -1 | 0;
  activeView: CalendarView;
  setActiveView: (view: CalendarView) => void;
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  selectedDate: Date;
  setSelectedDate: (date: Date, direction?: 1 | -1 | 0) => void;
};

export const useCalendarStore = create<CalendarState>((set) => ({
  direction: 0,
  activeView: "month",
  setActiveView: (view) => set({ activeView: view }),
  currentDate: new Date(),
  setCurrentDate: (date) => set({ currentDate: new Date() }),
  selectedDate: new Date(),
  setSelectedDate: (date, direction = 0) => set({ selectedDate: date, direction: direction }),
}));

"use client";

import { create } from "zustand";
import type { SchedulePlan } from "@/app/_types/types";

type ScheduleActivityStatus = "idle" | "running" | "done" | "error";

type ScheduleActivityState = {
  status: ScheduleActivityStatus;
  placed: number;
  message: string | null;
  start: () => void;
  finish: (plan: SchedulePlan) => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

export const useScheduleActivityStore = create<ScheduleActivityState>((set) => ({
  status: "idle",
  placed: 0,
  message: null,
  start: () => set({ status: "running", message: "Auto-scheduling your tasks…", placed: 0 }),
  finish: (plan) => {
    const placed = plan.proposals.length;
    set({
      status: "done",
      placed,
      message:
        placed > 0
          ? `Placed ${placed} task${placed === 1 ? "" : "s"} on the calendar`
          : "Calendar is up to date",
    });
  },
  fail: (message) => set({ status: "error", message }),
  dismiss: () => set({ status: "idle", message: null, placed: 0 }),
}));

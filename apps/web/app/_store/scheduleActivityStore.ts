"use client";

import { create } from "zustand";
import type { SchedulePlan } from "@/app/_types/types";

type ScheduleActivityStatus = "idle" | "running" | "done" | "error";

type ScheduleActivityState = {
  status: ScheduleActivityStatus;
  placed: number;
  message: string | null;
  /** The last applied plan, for "Show me". */
  plan: SchedulePlan | null;
  replay: boolean;
  showReplay: () => void;
  hideReplay: () => void;
  start: () => void;
  finish: (plan: SchedulePlan) => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

export const useScheduleActivityStore = create<ScheduleActivityState>((set) => ({
  status: "idle",
  placed: 0,
  message: null,
  plan: null,
  replay: false,
  showReplay: () => set({ replay: true }),
  hideReplay: () => set({ replay: false }),
  start: () => set({ status: "running", message: "Auto-scheduling your tasks…", placed: 0, plan: null, replay: false }),
  finish: (plan) => {
    const placed = plan.proposals.length;
    set({
      status: "done",
      plan,
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

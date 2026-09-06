import { create } from "zustand";

type Status = "idle" | "running" | "done" | "error";

type ScheduleActivityState = {
  status: Status;
  message: string | null;
  start: () => void;
  finish: (placed: number) => void;
  fail: (message: string) => void;
  dismiss: () => void;
};

export const useScheduleActivity = create<ScheduleActivityState>((set) => ({
  status: "idle",
  message: null,
  start: () => set({ status: "running", message: "Auto-scheduling your tasks…" }),
  finish: (placed) =>
    set({
      status: "done",
      message:
        placed > 0
          ? `Placed ${placed} task${placed === 1 ? "" : "s"} on the calendar`
          : "Calendar is up to date",
    }),
  fail: (message) => set({ status: "error", message }),
  dismiss: () => set({ status: "idle", message: null }),
}));

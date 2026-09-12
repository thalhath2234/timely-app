"use client";

import { useQueryClient } from "@tanstack/react-query";
import { applySchedule } from "@/app/utils/api/schedule";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";

let queue: Promise<void> = Promise.resolve();

/** Rebuilds engine blocks after a create so new work and new busy time land. */
export function useAutoScheduleAfterChange() {
  const queryClient = useQueryClient();

  return () => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        const store = useScheduleActivityStore.getState();
        store.start();
        try {
          const plan = await applySchedule({});
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["calendar"] }),
            queryClient.invalidateQueries({ queryKey: ["tasks"] }),
            queryClient.invalidateQueries({ queryKey: ["events"] }),
          ]);
          store.finish(plan);
        } catch (err) {
          store.fail(err instanceof Error ? err.message : "Could not auto-schedule.");
        }
      });
    return queue;
  };
}

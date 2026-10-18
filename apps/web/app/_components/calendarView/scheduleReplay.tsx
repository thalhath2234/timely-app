"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { replayFromSchedule } from "@/app/_components/film/replay/plan";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";

const ReplayPlayer = dynamic(() => import("@/app/_components/film/replayPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-[8/5] w-full bg-panel" />,
});

/**
 * "Show me": the last auto-schedule run replayed with the user's own blocks
 * arriving on their week (docs/design-system.md#empty-states lists the loops;
 * this is the one data-driven composition). Opens from the status toast and
 * the Waiting rail's state line.
 */
export default function ScheduleReplayDialog() {
  const plan = useScheduleActivityStore((state) => state.plan);
  const open = useScheduleActivityStore((state) => state.replay);
  const hide = useScheduleActivityStore((state) => state.hideReplay);
  const replay = useMemo(() => (plan ? replayFromSchedule(plan) : null), [plan]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hide]);

  if (!open || !replay) return null;
  const count = replay.placed.length + replay.moved.length;
  return (
    <>
      <OverlayScrim className="z-50 bg-black/60 backdrop-blur-[4px]" onPointerDown={hide} />
      <OverlayFrame className="z-50 items-center justify-center p-3 md:px-6">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label="What auto-schedule did"
          className="relative flex w-full max-w-[760px] flex-col overflow-hidden rounded-[20px] border border-border bg-background shadow-2xl shadow-black/40"
          data-testid="schedule-replay"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">What auto-schedule did</p>
              <p className="truncate text-xs text-muted-foreground">
                {count} block{count === 1 ? "" : "s"} on {replay.days[0]}
                {replay.days.length > 1 ? ` to ${replay.days[replay.days.length - 1]}` : ""}
                {replay.moved.length ? ` · ${replay.moved.length} moved` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={hide}
              aria-label="Close"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="mx-4 mb-4 overflow-hidden rounded-[12px] border border-border bg-[#0b0b0f]">
            <ReplayPlayer plan={replay} />
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}

/** True when the last run has something to replay. */
export function useCanReplay() {
  const plan = useScheduleActivityStore((state) => state.plan);
  return useMemo(() => Boolean(plan && replayFromSchedule(plan)), [plan]);
}

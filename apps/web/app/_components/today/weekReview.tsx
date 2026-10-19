"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { reviewFileName, reviewFromData, reviewHours, reviewWeek } from "@/app/_components/film/review/plan";
import { useCalendarRange } from "@/app/utils/hooks/calendar";
import { useDocs } from "@/app/utils/hooks/docs";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useFocusSessions, useTasks } from "@/app/utils/hooks/tasks";

const ReviewPlayer = dynamic(() => import("@/app/_components/film/reviewPlayer"), {
  ssr: false,
  loading: () => <div className="aspect-video w-full rounded-[12px] bg-panel" />,
});

/**
 * "Week in review": this week's tasks, focus time, calendar, docs and sheets
 * as a fifteen-second film, played here and saved as a video from the
 * browser. Opens from Today's End of day card; mount it only while open so
 * each opening reads the week afresh.
 */
export default function WeekReviewDialog({ onClose }: { onClose: () => void }) {
  const [now] = useState(() => new Date());
  const { start, end } = useMemo(() => reviewWeek(now), [now]);
  const tasks = useTasks();
  const calendar = useCalendarRange(start, end);
  const sessions = useFocusSessions(start, end);
  const docs = useDocs();
  const sheets = useSheets();
  const loading = tasks.isLoading || calendar.isLoading || sessions.isLoading || docs.isLoading || sheets.isLoading;
  const failed = tasks.isError || calendar.isError || sessions.isError;
  const plan = useMemo(
    () =>
      loading || failed
        ? null
        : reviewFromData({ now, tasks: tasks.data ?? [], items: calendar.data?.items ?? [], sessions: sessions.data ?? [], docs: docs.data ?? [], sheets: sheets.data ?? [] }),
    [loading, failed, now, tasks.data, calendar.data, sessions.data, docs.data, sheets.data],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <OverlayScrim className="z-50 bg-black/60 backdrop-blur-[4px]" onPointerDown={onClose} />
      <OverlayFrame className="z-50 items-center justify-center p-3 md:px-6">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label="Week in review"
          className="relative flex w-full max-w-[880px] flex-col overflow-hidden rounded-[20px] border border-border bg-background shadow-2xl shadow-black/40"
          data-testid="week-review"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">Week in review</p>
              <p className="truncate text-xs text-muted-foreground">
                {plan ? `${plan.label} · ${plan.done.length} done · ${reviewHours(plan.focusMinutes)} focused · ${reviewHours(plan.plannedMinutes)} planned` : failed ? "Could not load this week" : "Reading this week…"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="px-4 pb-4">
            {plan ? (
              <ReviewPlayer plan={plan} fileName={reviewFileName(now)} />
            ) : failed ? (
              <div className="flex aspect-video w-full items-center justify-center rounded-[12px] border border-border bg-panel text-sm text-muted-foreground">
                The week could not be loaded. Close this and try again.
              </div>
            ) : (
              <div className="aspect-video w-full rounded-[12px] bg-panel" />
            )}
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}

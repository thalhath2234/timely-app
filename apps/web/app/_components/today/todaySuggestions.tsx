"use client";

import { useState } from "react";
import { CalendarPlus, Sparkles, Star, Target, X } from "lucide-react";
import { browserTimezone } from "@/app/utils/api/schedule";
import type { EffortKind } from "@/app/utils/api/decisions";
import { formatDuration, formatTime } from "@/app/utils/calendar";
import { useDecisionFeedback, useTodaySuggestions } from "@/app/utils/hooks/decisions";
import { useAddTaskBlock } from "@/app/utils/hooks/calendar";
import { useSetTodayFocus } from "@/app/utils/hooks/tasks";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useToastStore } from "@/app/_store/toastStore";
import Button from "@/app/_components/_ui/button";
import TodayPanel from "@/app/_components/today/todayPanel";

export const EFFORT_LABELS: Record<EffortKind, string> = {
  deep: "Deep focus",
  admin: "Admin",
  creative: "Creative",
  routine: "Routine",
};

/** The free gap's start, or the next five minutes when it has already begun
 * (suggestions are fetched ahead of the click). */
function gapStart(iso: string) {
  const step = 5 * 60_000;
  return new Date(Math.max(new Date(iso).getTime(), Math.ceil(Date.now() / step) * step));
}

/** Smart suggestions on Today: open Work worth focusing on today, tagged with
 * the goal it moves forward, and the best Work for the next free gap. Code
 * ranks the Work and finds the gap; nothing shows while suggestions are off,
 * and every row can be dismissed. Goal counts live in Habits and goals. */
export default function TodaySuggestions({
  date,
  version,
  slotsLeft,
}: {
  date: string;
  /** Changes when Today's focus or agenda changes, so the picks refresh. */
  version: string;
  slotsLeft: number;
}) {
  const { data } = useTodaySuggestions(browserTimezone(), version);
  const setFocus = useSetTodayFocus();
  const addBlock = useAddTaskBlock();
  const feedback = useDecisionFeedback();
  const openTask = useEntityDetailStore((state) => state.openTask);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  if (!data?.available) return null;

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const accept = () => {
    if (data.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };
  const toast = (message: string) => useToastStore.getState().show(message);

  const focus = (data.focus ?? []).filter((pick) => !hidden.has(`focus:${pick.taskId}`));
  const gap = data.gap?.task && !hidden.has(`gap:${data.gap.task.id}`) ? data.gap : undefined;
  if (!focus.length && !gap && !data.error) return null;

  const dismiss = (key: string) => (
    <Button variant="ghost" size="sm" icon aria-label="Dismiss" title="Dismiss" onClick={() => hide(key)}>
      <X />
    </Button>
  );
  const chip = "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground";

  return (
    <TodayPanel
      title="Suggested for today"
      icon={<Sparkles className="size-3.5 text-primary" />}
      meta="Smart suggestions"
      data-testid="today-suggestions"
      aria-label="Today suggestions"
    >
      <div className="space-y-2 text-sm">
        {data.error ? <p className="text-xs text-muted-foreground">{data.error}</p> : null}
        {focus.length ? (
          <ul>
            {focus.map((pick) => (
              <li key={pick.taskId} className="flex items-center gap-2 border-t border-border py-2 first:border-t-0 first:pt-0">
                <button type="button" onClick={() => openTask(pick.taskId)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-foreground hover:text-primary">{pick.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {pick.goal ? (
                      <span className={`${chip} inline-flex items-center gap-1 text-primary`}>
                        <Target className="size-3" /> {pick.goal}
                      </span>
                    ) : null}
                    {pick.reasons
                      .filter((reason) => reason !== "open work" && reason !== "unscheduled")
                      .map((reason) => (
                        <span key={reason} className={chip}>
                          {reason.charAt(0).toUpperCase() + reason.slice(1)}
                        </span>
                      ))}
                    {pick.effortKind ? <span className={chip}>{EFFORT_LABELS[pick.effortKind]}</span> : null}
                  </span>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={slotsLeft <= 0 || setFocus.isPending}
                  title={slotsLeft <= 0 ? "Today’s Focus is full" : "Add to Today focus"}
                  leading={<Star />}
                  onClick={() => {
                    accept();
                    void setFocus
                      .mutateAsync({ taskId: pick.taskId, date })
                      .then(() => toast(`Added “${pick.name}” to Today’s Focus`))
                      .catch(() => toast("Could not add it to Today’s Focus"));
                    hide(`focus:${pick.taskId}`);
                  }}
                >
                  Focus
                </Button>
                {dismiss(`focus:${pick.taskId}`)}
              </li>
            ))}
          </ul>
        ) : null}
        {gap?.task ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
            <span className="min-w-0 flex-1 text-muted-foreground">
              Free {formatTime(new Date(gap.start))}–{formatTime(new Date(gap.end))} ({formatDuration(gap.minutes)}):{" "}
              <strong className="font-medium text-foreground">{gap.task.name}</strong> fits here
              {gap.task.effortKind ? ` · ${EFFORT_LABELS[gap.task.effortKind]}` : ""}.
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={addBlock.isPending}
              leading={<CalendarPlus />}
              onClick={() => {
                const task = gap.task!;
                const start = gapStart(gap.start);
                const end = new Date(start.getTime() + task.minutes * 60_000);
                hide(`gap:${task.id}`);
                if (end > new Date(gap.end)) {
                  toast("That free time has passed");
                  return;
                }
                accept();
                void addBlock
                  .mutateAsync({ taskId: task.id, start: start.toISOString(), end: end.toISOString() })
                  .then(() => toast(`Scheduled “${task.name}” at ${formatTime(start)}`))
                  .catch(() => toast("Could not schedule it"));
              }}
            >
              Schedule here
            </Button>
            {dismiss(`gap:${gap.task.id}`)}
          </div>
        ) : null}
      </div>
    </TodayPanel>
  );
}

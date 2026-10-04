"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { formatDateTime, formatDuration, formatTime, isSameDay, toDateInputValue } from "@/app/utils/calendar";
import { useApplySchedule, usePreviewSchedule, useUndoSchedule } from "@/app/utils/hooks/calendar";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import { cn } from "@/app/utils/cn";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import type { PlanRequest } from "@/app/utils/api/schedule";

type AutoScheduleDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Working-hours editor lives in Settings; the dialog only links to it. */
  onOpenSettings?: () => void;
  /** Limit the run to these tasks; omit for every schedulable task. */
  taskIds?: string[];
};

function scheduleItemLabel(name?: string | null) {
  const title = name?.trim();
  if (title && !/^tsk_/i.test(title)) return title;
  return "Untitled";
}

const SKIP_REASONS: Record<string, string> = {
  no_capacity: "No free time before the end of the window",
  blocked: "Waiting on another task",
  manual: "Already placed by hand",
  no_duration: "No time estimate",
  reminder: "Reminders stay at their ping time",
  recurring: "Repeating reminder — stays on its rule",
  completed: "Already done",
  inbox: "Clarify this inbox item first",
  parent_has_subtasks: "Schedulable subtasks replace the parent",
  locked: "Pinned — the engine will not move it",
  frozen: "Inside the freeze window",
  workspace_excluded: "Workspace excluded from auto-schedule",
  contiguous_no_fit: "Must run in one sitting; no slot is long enough",
  before_earliest: "Cannot start before the earliest start time",
};

export default function AutoScheduleDialog({
  open,
  onClose,
  onOpenSettings,
  taskIds,
}: AutoScheduleDialogProps) {
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return open ? (
    <AutoSchedulePanel
      onClose={onClose}
      onOpenSettings={onOpenSettings}
      taskIds={taskIds}
    />
  ) : null;
}

function AutoSchedulePanel({
  onClose,
  onOpenSettings,
  taskIds,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
  taskIds?: string[];
}) {
  const preview = usePreviewSchedule();
  const apply = useApplySchedule();
  const undo = useUndoSchedule();
  const updateTask = useUpdateTask();
  const [includeManual, setIncludeManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [previewDiverged, setPreviewDiverged] = useState(false);
  const [horizonDays, setHorizonDays] = useState<number | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const planArgs = (): PlanRequest => {
    const next: PlanRequest = { includeManual, taskIds };
    if (horizonDays != null) {
      const to = new Date();
      to.setDate(to.getDate() + horizonDays);
      next.to = to.toISOString();
    }
    return next;
  };

  const { mutate: runPreview } = preview;
  useEffect(() => {
    runPreview(planArgs());
    // planArgs is rebuilt from the same primitives each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeManual, runPreview, horizonDays, taskIds?.join(",")]);

  const toggleIncludeManual = (checked: boolean) => {
    if (applied) setPreviewDiverged(true);
    setApplied(false);
    setIncludeManual(checked);
  };

  const plan = applied && !previewDiverged && apply.data ? apply.data : preview.data;
  const proposals = plan?.proposals ?? [];
  const skipped = (plan?.skipped ?? []).filter(
    (item) => item.reason !== "recurring" && item.reason !== "completed",
  );
  const changes = plan?.changes ?? [];
  const risks = plan?.risks ?? [];
  const capacity = plan?.capacity ?? [];
  const lateCount = proposals.filter((item) => item.pastDeadline).length;
  const partialCount = proposals.filter((item) => item.partial).length;
  const canUndo = Boolean(plan?.canUndo);
  const currentHorizonDays =
    horizonDays ??
    (plan
      ? Math.max(
          1,
          Math.round(
            (new Date(plan.to).getTime() - new Date(plan.from).getTime()) / 86_400_000,
          ),
        )
      : 14);
  const scoped = Boolean(taskIds?.length);

  const confirm = async () => {
    setError(null);
    const activity = useScheduleActivityStore.getState();
    activity.start();
    try {
      const result = await apply.mutateAsync(planArgs());
      activity.finish(result);
      setApplied(true);
      setPreviewDiverged(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not apply schedule.";
      activity.fail(message);
      setError(message);
    }
  };

  const undoLast = async () => {
    setError(null);
    try {
      await undo.mutateAsync();
      setApplied(false);
      setPreviewDiverged(false);
      runPreview(planArgs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo schedule.");
    }
  };

  const extendHorizon = () => {
    const next = Math.min(90, currentHorizonDays + 7);
    if (applied) setPreviewDiverged(true);
    setApplied(false);
    setHorizonDays(next);
  };

  const allowSplitting = async (taskId: string) => {
    setBusyTaskId(taskId);
    setError(null);
    try {
      await updateTask.mutateAsync({ id: taskId, contiguous: false, minChunkMinutes: 15 });
      if (applied) setPreviewDiverged(true);
      setApplied(false);
      runPreview(planArgs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not allow splitting.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const pushDeadline = async (taskId: string, endsAt?: string, deadline?: string | null) => {
    setBusyTaskId(taskId);
    setError(null);
    try {
      const source = endsAt || deadline;
      const base = source ? new Date(source) : new Date();
      if (Number.isNaN(base.getTime())) {
        base.setTime(Date.now());
      }
      base.setDate(base.getDate() + 1);
      await updateTask.mutateAsync({ id: taskId, deadline: toDateInputValue(base) });
      if (applied) setPreviewDiverged(true);
      setApplied(false);
      runPreview(planArgs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the deadline.");
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <>
      <OverlayScrim
        className="z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
        onClick={onClose}
      />
      <OverlayFrame className="z-50 items-center justify-center p-4">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-label="Auto-schedule"
          className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>

          <div className="pr-8">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" />
              Auto-schedule
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {applied
                ? "Schedule applied. Undo restores the previous engine blocks."
                : scoped
                  ? "This run only places the selected task. Nothing is saved until you apply."
                  : "Open work is placed into working hours around events, pins, and freeze. Nothing is saved until you apply."}
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeManual}
              onChange={(event) => toggleIncludeManual(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            Also move blocks I placed by hand
          </label>
          {previewDiverged ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              This preview is different from what was last applied. Apply again to save it, or undo the previous run.
            </p>
          ) : null}

          {preview.isPending && !plan && (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Planning...
            </p>
          )}

          {preview.isError && (
            <p className="text-xs text-destructive">
              {preview.error instanceof Error
                ? preview.error.message
                : "Could not build a preview."}
            </p>
          )}

          {plan && (
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {formatDateTime(new Date(plan.from))} –{" "}
                  {formatDateTime(new Date(plan.to))}
                </span>
                <span className="tabular-nums">
                  {formatDuration(plan.plannedMinutes)} planned of{" "}
                  {formatDuration(plan.freeMinutes)} free
                </span>
                {plan.freeMinutes === 0 && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Set working hours
                  </button>
                )}
              </div>

              {risks.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {risks.map((risk, index) => (
                    <li key={`${risk.kind}-${risk.taskId ?? index}`} className="flex items-start gap-1">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {risk.taskName ? `${risk.taskName}: ` : ""}
                        {risk.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {capacity.length > 0 && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                    Capacity by day
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {capacity.map((day) => (
                      <li
                        key={day.date}
                        className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
                      >
                        <span className="tabular-nums text-foreground">{formatCapacityDate(day.date)}</span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            day.overCapacity ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {formatDuration(day.plannedMinutes)} of {formatDuration(day.availableMinutes)}
                          {day.overCapacity ? " over capacity" : ""}
                          {day.atRisk && !day.overCapacity ? " at risk" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {changes.length > 0 && (
                <details className="rounded-lg border border-border" open>
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                    {changes.length} change{changes.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {changes.map((change, index) => (
                      <li
                        key={`${change.action}-${change.taskId}-${index}`}
                        className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {scheduleItemLabel(change.taskName)}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{change.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {proposals.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing to place. Tasks need a time estimate and no pinned block.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {proposals.map((proposal) => (
                    <li
                      key={`${proposal.taskId}-${proposal.blocks[0]?.occurrenceStart ?? ""}`}
                      className={cn(
                        "rounded-lg border px-3 py-2",
                        proposal.pastDeadline || proposal.partial
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {scheduleItemLabel(proposal.taskName)}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {proposal.blocks.length > 1
                            ? `${proposal.blocks.length} blocks`
                            : "1 block"}
                          {typeof proposal.placedMinutes === "number" &&
                          typeof proposal.requiredMinutes === "number"
                            ? ` · ${formatDuration(proposal.placedMinutes)} of ${formatDuration(proposal.requiredMinutes)}`
                            : ""}
                        </span>
                      </div>
                      {proposal.partial && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="size-3" />
                          Partially placed — {formatDuration(proposal.shortfallMinutes ?? 0)} still
                          need a slot
                        </p>
                      )}
                      {proposal.partial ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={extendHorizon}
                            disabled={currentHorizonDays >= 90}
                            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Extend horizon
                          </button>
                          <button
                            type="button"
                            onClick={() => void allowSplitting(proposal.taskId)}
                            disabled={busyTaskId === proposal.taskId}
                            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Allow splitting
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void pushDeadline(
                                proposal.taskId,
                                proposal.endsAt,
                                proposal.deadline,
                              )
                            }
                            disabled={busyTaskId === proposal.taskId}
                            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Push deadline
                          </button>
                        </div>
                      ) : null}
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {proposal.blocks.map((block) => {
                          const start = new Date(block.start);
                          const end = new Date(block.end);
                          return (
                            <li key={`${proposal.taskId}-${block.chunkIndex}`} className="tabular-nums">
                              {formatDateTime(start)} – {formatTime(end)}
                              {!isSameDay(start, end) ? ` (${formatDateTime(end)})` : ""}
                            </li>
                          );
                        })}
                      </ul>
                      {proposal.reason ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{proposal.reason}</p>
                      ) : null}
                      {proposal.pastDeadline && proposal.deadline && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="size-3" />
                          Finishes after the{" "}
                          {new Date(proposal.deadline).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          deadline
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {skipped.length > 0 && (
                <details className="rounded-lg border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
                    {skipped.length} not placed
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {skipped.map((item) => (
                      <li
                        key={item.taskId}
                        className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">{scheduleItemLabel(item.taskName)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {item.message || SKIP_REASONS[item.reason] || item.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            {(lateCount > 0 || partialCount > 0) && (
              <span className="mr-auto flex flex-col gap-1 text-xs text-destructive">
                <span>
                  {[
                    lateCount > 0 ? `${lateCount} past deadline` : null,
                    partialCount > 0 ? `${partialCount} partially placed` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {partialCount > 0 && currentHorizonDays < 90 ? (
                  <button
                    type="button"
                    onClick={extendHorizon}
                    className="w-fit text-left text-[11px] text-primary underline-offset-2 hover:underline"
                  >
                    Extend planning window to {currentHorizonDays + 7} days
                  </button>
                ) : null}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg bg-secondary px-3 py-1.5 font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              {applied ? "Done" : "Cancel"}
            </button>
            {(canUndo || applied) && (
              <button
                type="button"
                onClick={undoLast}
                disabled={undo.isPending}
                className="cursor-pointer rounded-lg bg-secondary px-3 py-1.5 font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-60"
              >
                {undo.isPending ? "Undoing..." : "Undo last apply"}
              </button>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={apply.isPending || applied || !plan || proposals.length === 0}
              className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {apply.isPending ? "Applying..." : "Apply schedule"}
            </button>
          </div>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}

function formatCapacityDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

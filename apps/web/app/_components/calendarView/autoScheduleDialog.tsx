"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import * as motion from "motion/react-client";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { formatDateTime, formatDuration, formatTime, isSameDay } from "@/app/utils/calendar";
import { useApplySchedule, usePreviewSchedule, useUndoSchedule } from "@/app/utils/hooks/calendar";
import { cn } from "@/app/utils/cn";

type AutoScheduleDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Working-hours editor lives in Settings; the dialog only links to it. */
  onOpenSettings?: () => void;
};

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
}: AutoScheduleDialogProps) {
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && <AutoSchedulePanel onClose={onClose} onOpenSettings={onOpenSettings} />}
    </AnimatePresence>
  );
}

function AutoSchedulePanel({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const preview = usePreviewSchedule();
  const apply = useApplySchedule();
  const undo = useUndoSchedule();
  const [includeManual, setIncludeManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: runPreview } = preview;
  useEffect(() => {
    setApplied(false);
    runPreview({ includeManual });
  }, [includeManual, runPreview]);

  const [applied, setApplied] = useState(false);
  const plan = (applied && apply.data) || preview.data;
  const proposals = plan?.proposals ?? [];
  const skipped = (plan?.skipped ?? []).filter(
    (item) => item.reason !== "recurring" && item.reason !== "completed",
  );
  const changes = plan?.changes ?? [];
  const risks = plan?.risks ?? [];
  const capacity = plan?.capacity ?? [];
  const lateCount = proposals.filter((item) => item.pastDeadline).length;
  const canUndo = Boolean(plan?.canUndo);

  const confirm = async () => {
    setError(null);
    try {
      await apply.mutateAsync({ includeManual });
      setApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply schedule.");
    }
  };

  const undoLast = async () => {
    setError(null);
    try {
      await undo.mutateAsync();
      setApplied(false);
      runPreview({ includeManual });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo schedule.");
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 p-4 supports-backdrop-filter:backdrop-blur-xs"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Auto-schedule"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
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
              : "Open work is placed into working hours around events, pins, and freeze. Nothing is saved until you apply."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeManual}
            onChange={(event) => setIncludeManual(event.target.checked)}
            className="size-3.5 accent-primary"
          />
          Also move blocks I placed by hand
        </label>

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
                        {change.taskName || change.taskId}
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
                      proposal.pastDeadline
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {proposal.taskName}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {proposal.blocks.length > 1
                          ? `${proposal.blocks.length} blocks`
                          : "1 block"}
                      </span>
                    </div>
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
                        {new Date(proposal.deadline).toLocaleDateString("en-US", {
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
                      <span className="min-w-0 flex-1 truncate">{item.taskName}</span>
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
          {lateCount > 0 && (
            <span className="mr-auto text-xs text-destructive">
              {lateCount} task{lateCount === 1 ? "" : "s"} past deadline
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
      </motion.div>
    </motion.div>
  );
}

function formatCapacityDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

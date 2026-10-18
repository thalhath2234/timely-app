"use client";

import { motion } from "motion/react";
import { ArrowUpRight, BellRing, CheckSquare, SkipForward, Sparkles, Trash2 } from "lucide-react";
import { inboxSuggestionRows, inboxSuggestionSummary, type InboxAge } from "@timely/contract/inbox";
import Button from "@/app/_components/_ui/button";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { useClarifySuggestions, useDecisions } from "@/app/utils/hooks/decisions";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { cn } from "@/app/utils/cn";
import type { Task } from "@/app/_types/types";
import { springSoft } from "@/app/_components/_ui/motion";

export type InboxDecision = "task" | "reminder";

/**
 * The capture that has waited longest, as the film's Up next panel: an
 * eyebrow, the title, grouped rows of what it would become (filled in by
 * smart suggestions when they are on) and one-step decisions: task,
 * reminder, later or delete.
 */
export default function UpNextCard({
  task,
  age,
  ageLabel,
  canSkip,
  onDecide,
  onSkip,
  onDelete,
}: {
  task: Task;
  age: InboxAge;
  ageLabel: string;
  /** False when this is the only capture, so there is nothing to put it behind. */
  canSkip: boolean;
  onDecide: (kind: InboxDecision) => void;
  onSkip: () => void;
  onDelete: () => void;
}) {
  const decisionsOn = useDecisions().data?.available === true;
  // Asked with suggestions off too: plain code still reads "Remind me…" and dates.
  const suggestions = useClarifySuggestions(task.id);
  const workspaces = useWorkspaces().data ?? [];
  const s = suggestions.data?.available ? suggestions.data : undefined;
  const workspaceName = s ? workspaces.find((w) => w.id === s.workspaceId)?.name : undefined;
  const summary = s ? inboxSuggestionSummary(s, workspaceName, task.id) : undefined;
  const rows = inboxSuggestionRows(s, workspaceName);
  const duplicates = summary?.duplicates ?? [];
  const remindFirst = s?.kind === "reminder";
  const thinking = decisionsOn && suggestions.isLoading;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.985 }}
      transition={springSoft}
      aria-labelledby={`up-next-${task.id}`}
      data-testid="inbox-up-next"
      className="flex flex-col gap-3.5 rounded-[12px] border border-border bg-card p-4 shadow-[0_12px_32px_-20px_rgba(79,70,229,0.35)]"
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Up next · oldest capture</p>
          <Button size="sm" icon variant="destructive-ghost" className="-mr-1.5 -mt-1" aria-label="Delete" title="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
        <h2 id={`up-next-${task.id}`} className="mt-1.5 text-lg font-semibold leading-6 tracking-[-0.01em] text-foreground">
          {task.name}
        </h2>
        <p className={cn("mt-1 text-xs", age.stale ? "font-medium text-warning" : "text-muted-foreground")}>{ageLabel}</p>
        {task.description ? (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{task.description}</p>
        ) : null}
      </div>

      <ListGroup className="bg-background/40">
        {rows.map((row) => (
          <ListRow key={row.label} label={<span className="font-normal text-muted-foreground">{row.label}</span>} className="min-h-9">
            <span className={cn("truncate text-[13px]", row.suggested ? "font-medium text-primary" : "text-foreground")}>
              {row.value}
              {row.suggested ? <span className="font-normal text-muted-foreground"> · suggested</span> : null}
            </span>
          </ListRow>
        ))}
      </ListGroup>

      {thinking || summary?.note || duplicates.length > 0 ? (
        <div className="flex items-start gap-2 text-xs" data-testid="inbox-up-next-suggestion">
          {thinking ? (
            <>
              <LogoSpinner size={13} label="Getting a suggestion" />
              <span className="text-muted-foreground">Getting a suggestion…</span>
            </>
          ) : (
            <>
              <Sparkles className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {summary?.note ? <p className="text-muted-foreground">{summary.note}</p> : null}
                {duplicates.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="inbox-up-next-duplicates">
                    <span className="text-muted-foreground">Might already exist. Same thing? Delete this capture.</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {duplicates.map((dup) => (
                        <button
                          key={dup.id}
                          type="button"
                          onClick={() => useEntityDetailStore.getState().openTask(dup.id)}
                          aria-label={`Open “${dup.name}”`}
                          title="Open it to compare. Closing it brings you back here."
                          className="inline-flex h-6 max-w-56 items-center gap-1 rounded-md border border-border bg-background px-1.5 font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate">{dup.name}</span>
                          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={remindFirst ? "outline" : "primary"} leading={<CheckSquare />} onClick={() => onDecide("task")}>
          Make it a task
        </Button>
        <Button size="sm" variant={remindFirst ? "primary" : "outline"} leading={<BellRing />} onClick={() => onDecide("reminder")}>
          Reminder
        </Button>
        {canSkip ? (
          <Button size="sm" variant="ghost" leading={<SkipForward />} onClick={onSkip}>
            Later
          </Button>
        ) : null}
      </div>
    </motion.article>
  );
}

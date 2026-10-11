"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { BellRing, CheckSquare, Clock, SkipForward, Sparkles, Trash2 } from "lucide-react";
import { inboxSuggestionSummary, type InboxAge } from "@timely/contract/inbox";
import Button, { Kbd } from "@/app/_components/_ui/button";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { useClarifySuggestions, useDecisions } from "@/app/utils/hooks/decisions";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { cn } from "@/app/utils/cn";
import type { Task } from "@/app/_types/types";
import { springSoft } from "@/app/_components/_ui/motion";

export type InboxDecision = "task" | "reminder";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

/**
 * The capture that has waited longest, shown big with what smart suggestions
 * would make of it and one-key decisions: T task, R reminder, S skip,
 * Delete. Keys work while nothing else has focus, like the app's shortcuts.
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
  const suggestions = useClarifySuggestions(task.id, decisionsOn);
  const workspaces = useWorkspaces().data ?? [];
  const s = suggestions.data?.available ? suggestions.data : undefined;
  const summary = s ? inboxSuggestionSummary(s, workspaces.find((w) => w.id === s.workspaceId)?.name) : undefined;
  const remindFirst = s?.kind === "reminder";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      const run =
        key === "t" ? () => onDecide("task")
        : key === "r" ? () => onDecide("reminder")
        : key === "s" && canSkip ? onSkip
        : key === "delete" || key === "backspace" ? onDelete
        : null;
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDecide, onSkip, onDelete, canSkip]);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.985 }}
      transition={springSoft}
      aria-labelledby={`up-next-${task.id}`}
      data-testid="inbox-up-next"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_12px_32px_-20px_rgba(79,70,229,0.35)]"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
            age.stale ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Clock className={cn("size-3.5", age.stale ? "text-warning" : "")} aria-hidden />
          {ageLabel}
        </span>
      </div>
      <div className="min-w-0">
        <h2 id={`up-next-${task.id}`} className="text-xl font-semibold leading-snug tracking-tight text-foreground">
          {task.name}
        </h2>
        {task.description ? (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{task.description}</p>
        ) : null}
      </div>
      {decisionsOn && (suggestions.isLoading || summary?.line || summary?.note) ? (
        <div
          className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.05] px-3.5 py-2.5 text-sm"
          data-testid="inbox-up-next-suggestion"
        >
          {suggestions.isLoading ? (
            <>
              <LogoSpinner size={14} label="Getting a suggestion" />
              <span className="text-muted-foreground">Getting a suggestion…</span>
            </>
          ) : (
            <>
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                {summary?.line ? (
                  <p className="text-accent-foreground">
                    <span className="font-medium">Suggested:</span> {summary.line}. The form opens filled in.
                  </p>
                ) : null}
                {summary?.note ? <p className="text-muted-foreground">{summary.note}</p> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={remindFirst ? "outline" : "primary"}
          leading={<CheckSquare />}
          trailing={<Kbd>T</Kbd>}
          onClick={() => onDecide("task")}
        >
          Make it a task
        </Button>
        <Button
          variant={remindFirst ? "primary" : "outline"}
          leading={<BellRing />}
          trailing={<Kbd>R</Kbd>}
          onClick={() => onDecide("reminder")}
        >
          Remind me
        </Button>
        {canSkip ? (
          <Button variant="ghost" leading={<SkipForward />} trailing={<Kbd>S</Kbd>} onClick={onSkip}>
            Later
          </Button>
        ) : null}
        <Button
          variant="destructive-ghost"
          className="ml-auto"
          leading={<Trash2 />}
          trailing={<Kbd>Del</Kbd>}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </motion.article>
  );
}

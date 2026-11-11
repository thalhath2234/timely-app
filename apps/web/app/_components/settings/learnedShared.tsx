"use client";
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { laterSkillChanges, undoAlsoText, type LearningEvent } from "@timely/contract/agentLearning";
import Button from "@/app/_components/_ui/button";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { cn } from "@/app/utils/cn";

/**
 * Small parts the "What Timely learned" sections share (Settings → Learned,
 * plan 9b.4).
 */

export function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** A row that says a list could not be read, inside a ListGroup, with Retry. */
export function ErrorRow({
  error,
  what,
  onRetry,
  retrying,
}: {
  error: unknown;
  what: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div role="alert" className="flex items-start gap-2.5 px-3.5 py-2.5">
      <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground">
          Couldn&apos;t load {what}
        </span>
        <span className="block text-xs leading-4 text-muted-foreground">
          {errorText(error, "The agent did not answer. Nothing here is lost.")}
        </span>
      </span>
      {onRetry && (
        <Button variant="ghost" size="sm" loading={retrying} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** A quiet line inside a ListGroup when there is nothing to list. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-2.5 text-[13px] text-muted-foreground">{children}</p>;
}

/** A small pill after a skill's name: "Restored, review", "Locked", … */
export function Tag({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning" | "primary";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold",
        tone === "warning"
          ? "bg-warning/12 text-warning-text"
          : tone === "primary"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** "Nov 11, 10:02" for a feed or history time (an ISO string or seconds). */
export function when(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Undo, after a confirm when it would also take back later changes to the same skill (the person's
 * own edits included), which nothing offers a way back from.
 */
export function confirmUndo(event: LearningEvent, events: LearningEvent[], undo: (id: string) => Promise<unknown>) {
  const go = async () => {
    try {
      await undo(event.id);
    } catch (err) {
      useToastStore.getState().show(errorText(err, "Couldn't undo that."));
    }
  };
  const also = undoAlsoText(event, laterSkillChanges(events, event));
  if (!also) return void go();
  requestConfirm({ title: "Undo this change?", description: also, confirmLabel: "Undo", pendingLabel: "Undoing…", onConfirm: go });
}

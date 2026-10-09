"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Hourglass, X } from "lucide-react";
import type { StaleVerdict } from "@/app/utils/api/decisions";
import { useDecisionFeedback, useKeepStaleTask, useStaleWork } from "@/app/utils/hooks/decisions";
import { useUpdateTask } from "@/app/utils/hooks/tasks";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { showUndoToast } from "@/app/_store/toastStore";

const verdicts: Record<StaleVerdict, { label: string; className: string }> = {
  actionable: { label: "Still worth doing", className: "bg-success/10 text-success" },
  clarify: { label: "Needs clarifying", className: "bg-warning/10 text-warning" },
  blocked: { label: "Waiting on something", className: "bg-primary/10 text-primary" },
  obsolete: { label: "Maybe no longer needed", className: "bg-muted text-muted-foreground" },
};

const DISMISS_KEY = "timely.staleReview.hiddenUntil";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function hiddenUntil() {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/** A banner on the Tasks page for open Work nobody has touched in three
 * weeks, with smart suggestions' read of what each one needs. Keep, Done or
 * open each one; hiding it lasts a week. */
export default function StaleWorkReview() {
  const router = useRouter();
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now());
  const { data } = useStaleWork(!hidden);
  const keep = useKeepStaleTask();
  const update = useUpdateTask();
  const feedback = useDecisionFeedback();
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  if (hidden || !data?.available) return null;
  const tasks = data.tasks.filter((task) => !gone.has(task.id));
  if (tasks.length === 0) return null;

  const drop = (id: string) => setGone((prev) => new Set(prev).add(id));
  const sendFeedback = (verdict: StaleVerdict | undefined, accepted: boolean) => {
    if (data.logId && verdict) feedback.mutate({ logId: data.logId, accepted });
  };

  return (
    <section className="mx-4 mt-4 rounded-lg border border-border bg-muted/20" data-testid="stale-work" aria-label="Stale work review">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <Hourglass className="size-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 text-left text-foreground">
          <span className="truncate">
            {tasks.length} open task{tasks.length === 1 ? " has" : "s have"} had no activity for three weeks or more.
          </span>
          <span className="shrink-0 font-medium text-primary">{open ? "Hide" : "Review"}</span>
          <ChevronDown className={`size-3.5 shrink-0 text-primary transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          aria-label="Hide for a week"
          title="Hide for a week"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now() + WEEK));
            } catch {
              // still hidden for this visit
            }
            setHidden(true);
          }}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {open && (
        <ul className="border-t border-border p-1">
          {tasks.map((task) => {
            const verdict = task.verdict ? verdicts[task.verdict] : undefined;
            return (
              <li key={task.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() => openTasksEntity({ kind: "task", id: task.id }, { navigate: (href) => router.push(href, { scroll: false }) })}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
                >
                  {task.name}
                </button>
                <span className="text-xs text-muted-foreground">{task.idleDays} days idle</span>
                {verdict && <span className={`rounded-full px-2 py-0.5 text-xs ${verdict.className}`}>{verdict.label}</span>}
                <button
                  type="button"
                  onClick={() => {
                    keep.mutate(task.id);
                    sendFeedback(task.verdict, task.verdict === "actionable");
                    drop(task.id);
                  }}
                  className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => {
                    update.mutate({ id: task.id, completedAt: new Date().toISOString() });
                    sendFeedback(task.verdict, task.verdict === "obsolete");
                    drop(task.id);
                    showUndoToast(`“${task.name}” marked done`, () => {
                      update.mutate({ id: task.id, completedAt: "" });
                      setGone((prev) => {
                        const next = new Set(prev);
                        next.delete(task.id);
                        return next;
                      });
                    });
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Check className="size-3" /> Done
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
